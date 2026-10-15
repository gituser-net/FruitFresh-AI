
import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from inference_sdk import InferenceHTTPClient
from src.vision.visualize import visualize_predictions

# --------------------------------------------------
# 1. PROJECT CONFIGURATION
# --------------------------------------------------

# Project root: E:\FruitFresh-AI
PROJECT_ROOT = Path(__file__).resolve().parents[2]
ENV_FILE = PROJECT_ROOT / ".env"

load_dotenv(dotenv_path=ENV_FILE, override=True)

API_KEY = os.getenv("ROBOFLOW_API_KEY")
MODEL_ID = "fruit-ripening-process/2"

API_URL = "https://serverless.roboflow.com"


# --------------------------------------------------
# 2. INITIALIZE ROBOFLOW CLIENT
# --------------------------------------------------

def create_client():
    if not ENV_FILE.is_file():
        raise FileNotFoundError(
            f".env file not found at: {ENV_FILE}"
        )

    if not API_KEY or API_KEY == "your_actual_roboflow_api_key":
        raise RuntimeError(
            "ROBOFLOW_API_KEY is missing or still a placeholder.\n"
            f"Check your .env file: {ENV_FILE}"
        )

    return InferenceHTTPClient(
        api_url=API_URL,
        api_key=API_KEY,
    )


# --------------------------------------------------
# 3. RUN PREDICTION
# --------------------------------------------------

def predict_fruit(image_path):
    image_path = Path(image_path).expanduser()

    if not image_path.is_absolute():
        image_path = PROJECT_ROOT / image_path

    if not image_path.is_file():
        raise FileNotFoundError(
            f"Image not found: {image_path}"
        )

    print("\nConnecting to Roboflow...")
    print(f"Model: {MODEL_ID}")
    print(f"Image: {image_path}")

    client = create_client()

    result = client.infer(
        str(image_path),
        model_id=MODEL_ID,
    )

    return result


# --------------------------------------------------
# 4. DISPLAY DETECTIONS
# --------------------------------------------------

def display_results(result):
    print("\n" + "=" * 50)
    print("FRUITFRESH-AI | ROBOFLOW RESULTS")
    print("=" * 50)

    predictions = result.get("predictions", [])

    if not predictions:
        print("No fruit detections returned.")
        print(
            "Try a clear image with fruit visible "
            "against a simple background."
        )
    else:
        for index, item in enumerate(predictions, start=1):
            label = item.get("class", "unknown")
            confidence = float(item.get("confidence", 0.0))

            print(f"\nDetection {index}")
            print(f"  Class      : {label}")
            print(f"  Confidence : {confidence:.2%}")

            # Object-detection models commonly return boxes.
            for key in ("x", "y", "width", "height"):
                if key in item:
                    print(f"  {key:10} : {item[key]}")

    print("\nComplete API response:")
    print(json.dumps(result, indent=2, ensure_ascii=False))
    print("\nPrediction finished.")


# --------------------------------------------------
# 5. MAIN PROGRAM
# --------------------------------------------------

def main():
    print("=" * 50)
    print("FruitFresh-AI | Roboflow Prediction Test")
    print("=" * 50)
    print(f"Project root : {PROJECT_ROOT}")
    print(f".env found   : {ENV_FILE.is_file()}")
    print(f"API key set  : {bool(API_KEY)}")
    print(f"Model ID     : {MODEL_ID}")

    if len(sys.argv) > 1:
        image_path = " ".join(sys.argv[1:]).strip('"')
    else:
        image_path = input(
            "\nEnter the full path to a fruit image: "
        ).strip().strip('"')

    if not image_path:
        print("No image path supplied. Exiting.")
        return

    try:
        result = predict_fruit(image_path)
        display_results(result)
        
        visualize_predictions(image_path, result)
    except FileNotFoundError as exc:
        print(f"\nFILE ERROR: {exc}")

    except RuntimeError as exc:
        print(f"\nCONFIGURATION ERROR: {exc}")

    except Exception as exc:
        print(f"\nPREDICTION ERROR: {type(exc).__name__}: {exc}")
        print(
            "\nCheck your API key, internet connection, "
            "model availability, and Roboflow endpoint."
        )


if __name__ == "__main__":
    main()
