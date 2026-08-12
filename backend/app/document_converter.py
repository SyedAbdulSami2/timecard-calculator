from __future__ import annotations

import base64
import io
from pathlib import Path
from typing import Any

import fitz
from PIL import Image, ImageEnhance, ImageOps


SUPPORTED = {
    ".pdf",
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
    ".bmp",
    ".tif",
    ".tiff",
}


def _encode_png(image: Image.Image) -> str:
    buffer = io.BytesIO()

    image.save(
        buffer,
        format="PNG",
        optimize=True,
    )

    encoded = base64.b64encode(
        buffer.getvalue()
    ).decode("ascii")

    return f"data:image/png;base64,{encoded}"


def _prepare_image(
    image: Image.Image,
) -> Image.Image:
    image = ImageOps.exif_transpose(image)

    if image.mode not in ("RGB", "L"):
        image = image.convert("RGB")

    width, height = image.size

    target_width = 2200

    if width < target_width:
        scale = target_width / width

        image = image.resize(
            (
                round(width * scale),
                round(height * scale),
            ),
            Image.Resampling.LANCZOS,
        )

    gray = ImageOps.grayscale(image)

    gray = ImageEnhance.Contrast(
        gray
    ).enhance(1.7)

    gray = ImageEnhance.Sharpness(
        gray
    ).enhance(1.35)

    return gray.convert("RGB")


def _convert_image(
    data: bytes,
) -> list[Image.Image]:
    image = Image.open(
        io.BytesIO(data)
    )

    pages: list[Image.Image] = []

    frame = 0

    while True:
        try:
            image.seek(frame)

            pages.append(
                _prepare_image(
                    image.copy()
                )
            )

            frame += 1

        except EOFError:
            break

    return pages


def _convert_pdf(
    data: bytes,
) -> list[Image.Image]:
    try:
        document = fitz.open(
            stream=data,
            filetype="pdf",
        )

    except Exception as exc:
        raise ValueError(
            f"Could not open PDF: {exc}"
        ) from exc

    if document.page_count == 0:
        raise ValueError(
            "The PDF contains no pages."
        )

    images: list[Image.Image] = []

    matrix = fitz.Matrix(
        3.0,
        3.0,
    )

    for page_number in range(
        document.page_count
    ):
        page = document.load_page(
            page_number
        )

        pixmap = page.get_pixmap(
            matrix=matrix,
            alpha=False,
        )

        png_bytes = pixmap.tobytes(
            "png"
        )

        image = Image.open(
            io.BytesIO(
                png_bytes
            )
        )

        images.append(
            _prepare_image(
                image
            )
        )

    document.close()

    return images


def convert_document(
    filename: str,
    data: bytes,
) -> dict[str, Any]:
    extension = Path(
        filename or ""
    ).suffix.lower()

    if extension not in SUPPORTED:
        raise ValueError(
            "Unsupported document type. "
            "Upload PDF, JPG, JPEG, PNG, WEBP, "
            "BMP, TIFF, or TIF."
        )

    if not data:
        raise ValueError(
            "The uploaded file is empty."
        )

    if extension == ".pdf":
        images = _convert_pdf(
            data
        )
    else:
        images = _convert_image(
            data
        )

    pages = []

    for index, image in enumerate(
        images
    ):
        pages.append(
            {
                "page_number": index + 1,
                "width": image.width,
                "height": image.height,
                "image": _encode_png(
                    image
                ),
            }
        )

    return {
        "filename": filename,
        "page_count": len(
            pages
        ),
        "pages": pages,
    }
