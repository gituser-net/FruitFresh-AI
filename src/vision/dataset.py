
from pathlib import Path
import csv

import cv2


PROJECT_ROOT = Path(__file__).resolve().parents[2]
RAW_DIR = PROJECT_ROOT / "data" / "raw"
OUTPUT_DIR = PROJECT_ROOT / "data" / "splits"
MANIFEST_PATH = OUTPUT_DIR / "manifest.csv"

CLASSES = [
    "fresh",
    "ripening",
    "visible_rot",
    "uncertain",
]

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


def scan_dataset():
    records = []
    invalid_files = []
    counts = {name: 0 for name in CLASSES}

    for label in CLASSES:
        class_dir = RAW_DIR / label

        if not class_dir.is_dir():
            print(f"Missing class folder: {class_dir}")
            continue

        for path in class_dir.rglob("*"):
            if not path.is_file():
                continue

            if path.suffix.lower() not in IMAGE_EXTENSIONS:
                continue

            image = cv2.imread(str(path))

            if image is None:
                invalid_files.append(str(path))
                continue

            records.append({
                "image_path": path.relative_to(PROJECT_ROOT).as_posix(),
                "label": label,
                "width": image.shape[1],
                "height": image.shape[0],
            })
            counts[label] += 1

    return records, counts, invalid_files


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    records, counts, invalid_files = scan_dataset()

    with MANIFEST_PATH.open(
        "w", newline="", encoding="utf-8"
    ) as file:
        writer = csv.DictWriter(
            file,
            fieldnames=[
                "image_path",
                "label",
                "width",
                "height",
            ],
        )
        writer.writeheader()
        writer.writerows(records)

    print("\nDataset scan complete")
    print("-" * 35)

    for label, count in counts.items():
        print(f"{label:15}: {count}")

    print(f"\nValid images: {len(records)}")
    print(f"Unreadable images: {len(invalid_files)}")
    print(f"Manifest saved: {MANIFEST_PATH}")

    if invalid_files:
        print("\nUnreadable files:")
        for path in invalid_files:
            print(path)


if __name__ == "__main__":
    main()
