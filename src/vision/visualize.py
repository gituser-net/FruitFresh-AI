
from pathlib import Path

import cv2


PROJECT_ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIR = PROJECT_ROOT / "data" / "processed"


def visualize_predictions(image_path, result):
    """Draw Roboflow detections and save the annotated image."""

    image_path = Path(image_path)
    image = cv2.imread(str(image_path))

    if image is None:
        raise FileNotFoundError(f"Could not read image: {image_path}")

    predictions = result.get("predictions", [])

    for prediction in predictions:
        x = float(prediction["x"])
        y = float(prediction["y"])
        width = float(prediction["width"])
        height = float(prediction["height"])

        # Roboflow returns the center coordinates of each bounding box.
        x1 = int(x - width / 2)
        y1 = int(y - height / 2)
        x2 = int(x + width / 2)
        y2 = int(y + height / 2)

        label = prediction.get("class", "unknown")
        confidence = float(prediction.get("confidence", 0))

        # Keep the bounding box inside the image.
        h, w = image.shape[:2]
        x1 = max(0, min(x1, w - 1))
        y1 = max(0, min(y1, h - 1))
        x2 = max(0, min(x2, w - 1))
        y2 = max(0, min(y2, h - 1))

        color = (0, 200, 0)

        cv2.rectangle(image, (x1, y1), (x2, y2), color, 2)

        text = f"{label}: {confidence:.1%}"
        text_y = max(y1 - 10, 20)

        cv2.putText(
            image,
            text,
            (x1, text_y),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.6,
            color,
            2,
            cv2.LINE_AA,
        )

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    output_path = OUTPUT_DIR / f"{image_path.stem}_detected.jpg"

    if not cv2.imwrite(str(output_path), image):
        raise RuntimeError(f"Could not save output image: {output_path}")

    print(f"Detections: {len(predictions)}")
    print(f"Saved annotated image: {output_path}")

    return output_path
