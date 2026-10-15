
from pathlib import Path

import cv2
import numpy as np


IMAGE_SIZE = 224


def load_and_preprocess_image(image_path):
    """Load an image and prepare it for an AI model."""

    image_path = Path(image_path)

    if not image_path.is_file():
        raise FileNotFoundError(f"Image not found: {image_path}")

    # OpenCV loads images in BGR format.
    image = cv2.imread(str(image_path))

    if image is None:
        raise ValueError(f"Could not read image: {image_path}")

    # Convert BGR to RGB for model and display compatibility.
    image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)

    # Resize to the model's expected input dimensions.
    resized = cv2.resize(
        image_rgb,
        (IMAGE_SIZE, IMAGE_SIZE),
        interpolation=cv2.INTER_AREA,
    )

    # Convert pixels from 0–255 to 0–1.
    normalized = resized.astype(np.float32) / 255.0

    return image_rgb, resized, normalized


def main():
    image_path = input("Enter the image path: ").strip().strip('"')

    original, resized, normalized = load_and_preprocess_image(
        image_path
    )

    print("Image pipeline successful!")
    print("Original dimensions:", original.shape)
    print("Resized dimensions:", resized.shape)
    print("Normalized array:", normalized.shape)
    print("Pixel range:", normalized.min(), "to", normalized.max())

    # Display the resized image.
    cv2.imshow("FruitFresh-AI - Preprocessed Image", resized)
    cv2.waitKey(0)
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
