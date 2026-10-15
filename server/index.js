
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const path = require("path");
const fs = require("fs/promises");

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const app = express();
const PORT = Number(process.env.PORT) || 5000;
const MODEL_ID = "fruit-ripening-process/2";
const API_KEY = process.env.ROBOFLOW_API_KEY;

// Adafruit IO cloud configuration. Keep AIO_KEY only on the backend and ESP8266.
const AIO_USERNAME = (process.env.AIO_USERNAME || "").trim();
const AIO_KEY = (process.env.AIO_KEY || "").trim();
const AIO_TEMPERATURE_FEED = (process.env.AIO_TEMPERATURE_FEED || "temperature").trim();
const AIO_HUMIDITY_FEED = (process.env.AIO_HUMIDITY_FEED || "humidity").trim();
const AIO_MQ135_FEED = (process.env.AIO_MQ135_FEED || "mq135").trim();
const AIO_REFRESH_INTERVAL_MS = 15000;
const SENSOR_STALE_AFTER_MS = 90000;
const AIO_API_ROOT = "https://io.adafruit.com/api/v2";

const DATA_DIR = path.resolve(__dirname, "../data");
const HISTORY_FILE = path.join(DATA_DIR, "detection-history.json");

app.use(cors({
  origin: [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://10.197.254.3:5173",
  ],
}));

app.use(express.json({ limit: "5mb" }));

let historyQueue = Promise.resolve();

// Cached latest reading pulled from Adafruit IO. The ESP8266 publishes directly
// to the cloud, so sensor uploads do not depend on this laptop being online.
let latestSensorData = null;
let lastAioAttemptAt = 0;
let lastAioError = "";
let lastMq135Error = "";
let aioRefreshInFlight = null;

function adafruitConfigured() {
  // Temperature and humidity are required. MQ-135 is optional so the DHT22 data
  // remains visible while the gas sensor or its feed is being configured.
  return Boolean(AIO_USERNAME && AIO_KEY && AIO_TEMPERATURE_FEED && AIO_HUMIDITY_FEED);
}

async function fetchLatestAioFeed(feedKey) {
  const endpoint = new URL(
    `${AIO_API_ROOT}/${encodeURIComponent(AIO_USERNAME)}/feeds/${encodeURIComponent(feedKey)}/data/last`
  );

  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      "X-AIO-Key": AIO_KEY,
      "Accept": "application/json",
    },
    signal: AbortSignal.timeout(10000),
  });

  const responseText = await response.text();
  let record;
  try {
    record = JSON.parse(responseText);
  } catch {
    throw new Error(`Adafruit IO returned an unreadable response for feed '${feedKey}'.`);
  }

  if (!response.ok) {
    // Don't log or return credentials. Feed names and HTTP status are enough to troubleshoot.
    throw new Error(`Adafruit IO feed '${feedKey}' request failed (HTTP ${response.status}). Check the username, key, and feed key.`);
  }

  const value = Number(record.value);
  const createdAt = record.created_at || record.createdAt;
  const timestamp = Date.parse(createdAt);

  if (!Number.isFinite(value) || !Number.isFinite(timestamp)) {
    throw new Error(`Adafruit IO feed '${feedKey}' has no valid numeric reading yet. Publish a reading from the ESP8266 first.`);
  }

  return { value, createdAt: new Date(timestamp).toISOString() };
}

async function refreshAdafruitSensorCache(force = false) {
  if (!adafruitConfigured()) {
    lastAioError = "Configure AIO_USERNAME and AIO_KEY in the project root .env file.";
    return;
  }

  if (aioRefreshInFlight) {
    await aioRefreshInFlight;
    return;
  }

  const now = Date.now();
  if (!force && now - lastAioAttemptAt < AIO_REFRESH_INTERVAL_MS) return;
  lastAioAttemptAt = now;

  aioRefreshInFlight = (async () => {
    try {
      // DHT22 feeds are required. MQ-135 is fetched independently so a missing
      // or not-yet-published gas feed cannot hide valid temperature/humidity.
      const [temperatureResult, humidityResult, mq135Result] = await Promise.allSettled([
        fetchLatestAioFeed(AIO_TEMPERATURE_FEED),
        fetchLatestAioFeed(AIO_HUMIDITY_FEED),
        fetchLatestAioFeed(AIO_MQ135_FEED),
      ]);

      if (temperatureResult.status === "rejected") throw temperatureResult.reason;
      if (humidityResult.status === "rejected") throw humidityResult.reason;

      const temperature = temperatureResult.value;
      const humidity = humidityResult.value;
      const mq135 = mq135Result.status === "fulfilled" ? mq135Result.value : null;
      const pairTimestamp = Math.min(
        Date.parse(temperature.createdAt),
        Date.parse(humidity.createdAt)
      );

      latestSensorData = {
        deviceId: "ESP8266-ESP12E",
        source: "Adafruit IO",
        temperature: Number(temperature.value.toFixed(2)),
        humidity: Number(humidity.value.toFixed(2)),
        mq135Raw: mq135 ? Math.round(mq135.value) : null,
        receivedAt: new Date(pairTimestamp).toISOString(),
        temperatureUpdatedAt: temperature.createdAt,
        humidityUpdatedAt: humidity.createdAt,
        mq135UpdatedAt: mq135 ? mq135.createdAt : null,
      };
      lastAioError = "";
      lastMq135Error = mq135Result.status === "rejected"
        ? (mq135Result.reason?.message || "MQ-135 feed has no reading yet.")
        : "";
    } catch (error) {
      lastAioError = error.name === "TimeoutError"
        ? "Adafruit IO timed out. The last saved cloud reading is being retained."
        : error.message || "Could not read the Adafruit IO feeds.";
      console.error("Adafruit IO sensor refresh:", lastAioError);
    } finally {
      aioRefreshInFlight = null;
    }
  })();

  await aioRefreshInFlight;
}

async function readHistory() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  try {
    const content = await fs.readFile(HISTORY_FILE, "utf8");
    const records = JSON.parse(content);
    return Array.isArray(records) ? records : [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function queueHistoryWrite(operation) {
  const next = historyQueue.then(operation);
  historyQueue = next.catch((error) => {
    console.error("History storage error:", error.message);
  });
  return next;
}

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    model: MODEL_ID,
    apiKeyConfigured: Boolean(API_KEY),
    adafruitConfigured: adafruitConfigured(),
  });
});

// The dashboard reads this endpoint. The Node backend proxies Adafruit IO so the
// private Adafruit IO key is never exposed in browser JavaScript.
app.get("/api/sensors", async (req, res) => {
  await refreshAdafruitSensorCache();

  const ageMs = latestSensorData
    ? Date.now() - Date.parse(latestSensorData.receivedAt)
    : Infinity;
  const configured = adafruitConfigured();
  const connected = Boolean(latestSensorData && ageMs >= 0 && ageMs <= SENSOR_STALE_AFTER_MS);

  res.set("Cache-Control", "no-store");
  res.json({
    source: "Adafruit IO",
    configured,
    connected,
    data: latestSensorData,
    lastCheckedAt: lastAioAttemptAt ? new Date(lastAioAttemptAt).toISOString() : null,
    error: !configured
      ? "Adafruit IO is not configured. Add AIO_USERNAME and AIO_KEY to the project root .env file."
      : lastAioError || (!latestSensorData
        ? "No temperature/humidity cloud reading yet. Check the ESP8266 and the Adafruit IO temperature and humidity feeds."
        : (!connected ? "The latest temperature/humidity reading is older than 90 seconds. Check the ESP8266 and Adafruit IO feeds." : "")),
    mq135Error: lastMq135Error,
  });
});

app.get("/api/history", async (req, res) => {
  try {
    await historyQueue;
    const records = await readHistory();

    res.json({
      count: records.length,
      records: records.slice(-200).reverse(),
    });
  } catch (error) {
    console.error("History read error:", error.message);
    res.status(500).json({ error: "Could not load detection history." });
  }
});

app.post("/api/history", async (req, res) => {
  try {
    const { detections, image } = req.body || {};

    if (typeof image !== "string" || image.length > 200) {
      return res.status(400).json({ error: "Invalid source name." });
    }

    if (
      !Array.isArray(detections) ||
      detections.length > 100 ||
      !detections.every((item) =>
        typeof item.class === "string" &&
        item.class.length <= 100 &&
        Number.isFinite(item.confidence) &&
        item.confidence >= 0 &&
        item.confidence <= 1
      )
    ) {
      return res.status(400).json({ error: "Invalid detections." });
    }

    const record = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      image,
      detections,
      detectionCount: detections.length,
    };

    await queueHistoryWrite(async () => {
      const records = await readHistory();
      records.push(record);

      await fs.writeFile(
        HISTORY_FILE,
        JSON.stringify(records.slice(-5000), null, 2),
        "utf8"
      );
    });

    res.status(201).json({ saved: true, record });
  } catch (error) {
    console.error("History save error:", error.message);
    res.status(500).json({ error: "Could not save detection history." });
  }
});

app.post("/api/detect", async (req, res) => {
  try {
    if (!API_KEY) {
      return res.status(500).json({
        error: "ROBOFLOW_API_KEY is missing from the project root .env file.",
      });
    }

    const { image } = req.body || {};

    if (
      typeof image !== "string" ||
      !/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(image)
    ) {
      return res.status(400).json({ error: "A valid webcam frame is required." });
    }

    const base64Image = image.substring(image.indexOf(",") + 1);

    if (!base64Image || base64Image.length > 4_500_000) {
      return res.status(413).json({ error: "Image is empty or too large." });
    }

    const endpoint = new URL(
      `https://serverless.roboflow.com/${MODEL_ID}`
    );
    endpoint.searchParams.set("api_key", API_KEY);

    const inferenceResponse = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: base64Image,
      signal: AbortSignal.timeout(30000),
    });

    const responseText = await inferenceResponse.text();
    let result;

    try {
      result = JSON.parse(responseText);
    } catch {
      return res.status(502).json({
        error: "Roboflow returned an invalid response.",
      });
    }

    if (!inferenceResponse.ok) {
      console.error("Roboflow error:", inferenceResponse.status, result);
      return res.status(inferenceResponse.status).json({
        error: result.message || result.error || "Inference failed.",
      });
    }

    res.json(result);
  } catch (error) {
    console.error("Detection error:", error.message);

    res.status(error.name === "TimeoutError" ? 504 : 500).json({
      error: error.name === "TimeoutError"
        ? "Roboflow inference timed out."
        : "Detection request failed.",
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`FruitFresh AI API (local): http://localhost:${PORT}`);
  console.log(`FruitFresh AI API (LAN):   http://10.197.254.3:${PORT}`);
  console.log(`Sensor API (Adafruit proxy): http://localhost:${PORT}/api/sensors`);
  console.log(`Model: ${MODEL_ID}`);
  console.log(`Roboflow API key: ${API_KEY ? "configured" : "MISSING"}`);
  console.log(`Adafruit IO: ${adafruitConfigured() ? `configured (required: ${AIO_TEMPERATURE_FEED}, ${AIO_HUMIDITY_FEED}; optional: ${AIO_MQ135_FEED})` : "NOT CONFIGURED: set AIO_USERNAME and AIO_KEY in ../.env"}`);
});
