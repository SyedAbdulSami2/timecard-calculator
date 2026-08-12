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


MAX_WIDTH = 1400
PDF_SCALE = 1.4
JPEG_QUALITY = 72


def _encode_image(
    image: Image.Image,
) -> str:
    buffer = io.BytesIO()

    image.save(
        buffer,
        format="JPEG",
        quality=JPEG_QUALITY,
        optimize=True,
    )

    encoded = base64.b64encode(
        buffer.getvalue()
    ).decode("ascii")

    return (
        "data:image/jpeg;base64,"
        + encoded
    )


def _prepare_image(
    image: Image.Image,
) -> Image.Image:
    image = ImageOps.exif_transpose(
        image
    )

    image = image.convert("L")

    width, height = image.size

    if width > MAX_WIDTH:
        scale = MAX_WIDTH / width

        image = image.resize(
            (
                MAX_WIDTH,
                round(
                    height * scale
                ),
            ),
            Image.Resampling.LANCZOS,
        )

    image = ImageEnhance.Contrast(
        image
    ).enhance(1.35)

    image = ImageEnhance.Sharpness(
        image
    ).enhance(1.15)

    return image.convert("RGB")


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

            page = image.copy()

            pages.append(
                _prepare_image(
                    page
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
        document.close()

        raise ValueError(
            "The PDF contains no pages."
        )

    images: list[Image.Image] = []

    matrix = fitz.Matrix(
        PDF_SCALE,
        PDF_SCALE,
    )

    try:
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

            image = Image.frombytes(
                "RGB",
                (
                    pixmap.width,
                    pixmap.height,
                ),
                pixmap.samples,
            )

            prepared = _prepare_image(
                image
            )

            images.append(
                prepared
            )

            del pixmap
            del image

    finally:
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
            (
                "Unsupported document type. "
                "Upload PDF, JPG, JPEG, PNG, WEBP, "
                "BMP, TIFF, or TIF."
            )
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

    if not images:
        raise ValueError(
            "No document pages were produced."
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
                "image": _encode_image(
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
