from __future__ import annotations

import base64
import io
from pathlib import Path
from typing import Any

import fitz
from PIL import Image, ImageEnhance, ImageFilter, ImageOps


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


# Full page returned to frontend
FULL_PAGE_MAX_WIDTH = 1400

# OCR crop returned at higher resolution
OCR_CROP_MAX_WIDTH = 2200

PDF_SCALE = 1.8
JPEG_QUALITY = 78


# ============================================================
# ENCODING
# ============================================================

def _encode_image(
    image: Image.Image,
    quality: int = JPEG_QUALITY,
) -> str:
    buffer = io.BytesIO()

    image.save(
        buffer,
        format="JPEG",
        quality=quality,
        optimize=True,
    )

    encoded = base64.b64encode(
        buffer.getvalue()
    ).decode("ascii")

    return (
        "data:image/jpeg;base64,"
        + encoded
    )


# ============================================================
# IMAGE RESIZE
# ============================================================

def _resize_to_width(
    image: Image.Image,
    max_width: int,
) -> Image.Image:
    width, height = image.size

    if width <= max_width:
        return image.copy()

    scale = (
        max_width / width
    )

    new_height = round(
        height * scale
    )

    return image.resize(
        (
            max_width,
            new_height,
        ),
        Image.Resampling.LANCZOS,
    )


# ============================================================
# FULL PAGE PREPARATION
# ============================================================

def _prepare_full_page(
    image: Image.Image,
) -> Image.Image:
    image = ImageOps.exif_transpose(
        image
    )

    image = image.convert("RGB")

    image = _resize_to_width(
        image,
        FULL_PAGE_MAX_WIDTH,
    )

    return image


# ============================================================
# OCR PREPROCESSING
# ============================================================

def _prepare_ocr_image(
    image: Image.Image,
) -> Image.Image:
    """
    Prepare a section specifically for OCR.

    Improvements:
    - grayscale
    - enlarged
    - stronger contrast
    - sharpened
    - mild denoise
    """

    image = ImageOps.exif_transpose(
        image
    )

    image = image.convert("L")

    image = _resize_to_width(
        image,
        OCR_CROP_MAX_WIDTH,
    )

    # Increase contrast
    image = ImageEnhance.Contrast(
        image
    ).enhance(1.8)

    # Sharpen handwriting / printed table lines
    image = ImageEnhance.Sharpness(
        image
    ).enhance(2.0)

    # Small median filter reduces noise
    image = image.filter(
        ImageFilter.MedianFilter(
            size=3
        )
    )

    return image.convert("RGB")


# ============================================================
# OCR CROP
# ============================================================

def _create_timecard_crop(
    image: Image.Image,
) -> Image.Image:
    """
    Create a general-purpose crop for timecard tables.

    Many timecards place:
    - employee information near top
    - regular hours table in middle
    - signatures / callback sections below

    The crop deliberately keeps a broad region rather than
    assuming one exact template.
    """

    width, height = image.size

    # Remove top branding/header area.
    top = int(
        height * 0.18
    )

    # Keep most of the useful working-hours area,
    # but remove bottom signatures/footer.
    bottom = int(
        height * 0.74
    )

    # Slight horizontal trim to remove page margins.
    left = int(
        width * 0.015
    )

    right = int(
        width * 0.985
    )

    if bottom <= top:
        return image.copy()

    cropped = image.crop(
        (
            left,
            top,
            right,
            bottom,
        )
    )

    return _prepare_ocr_image(
        cropped
    )


# ============================================================
# OPTIONAL SECOND CROP
# ============================================================

def _create_center_table_crop(
    image: Image.Image,
) -> Image.Image:
    """
    A tighter crop for table-heavy layouts.

    The frontend can OCR both crops and combine the text.
    """

    width, height = image.size

    left = int(
        width * 0.02
    )

    right = int(
        width * 0.98
    )

    top = int(
        height * 0.28
    )

    bottom = int(
        height * 0.62
    )

    if bottom <= top:
        return image.copy()

    cropped = image.crop(
        (
            left,
            top,
            right,
            bottom,
        )
    )

    return _prepare_ocr_image(
        cropped
    )


# ============================================================
# IMAGE FILE CONVERSION
# ============================================================

def _load_image_pages(
    data: bytes,
) -> list[Image.Image]:
    image = Image.open(
        io.BytesIO(data)
    )

    pages: list[
        Image.Image
    ] = []

    frame = 0

    while True:
        try:
            image.seek(
                frame
            )

            page = image.copy()

            page = ImageOps.exif_transpose(
                page
            )

            page = page.convert(
                "RGB"
            )

            pages.append(
                page
            )

            frame += 1

        except EOFError:
            break

    return pages


# ============================================================
# PDF CONVERSION
# ============================================================

def _load_pdf_pages(
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

    pages: list[
        Image.Image
    ] = []

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

            pages.append(
                image.copy()
            )

            del pixmap
            del image

    finally:
        document.close()

    return pages


# ============================================================
# DOCUMENT CONVERTER
# ============================================================

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
        source_pages = (
            _load_pdf_pages(
                data
            )
        )

    else:
        source_pages = (
            _load_image_pages(
                data
            )
        )

    if not source_pages:
        raise ValueError(
            "No document pages were produced."
        )

    pages = []

    for index, source in enumerate(
        source_pages
    ):
        full_page = (
            _prepare_full_page(
                source
            )
        )

        ocr_crop = (
            _create_timecard_crop(
                source
            )
        )

        table_crop = (
            _create_center_table_crop(
                source
            )
        )

        pages.append(
            {
                "page_number":
                    index + 1,

                "width":
                    full_page.width,

                "height":
                    full_page.height,

                # Full page for preview/fallback OCR
                "image":
                    _encode_image(
                        full_page,
                        quality=72,
                    ),

                # Preferred OCR source
                "ocr_image":
                    _encode_image(
                        ocr_crop,
                        quality=84,
                    ),

                # Tighter table-focused OCR source
                "table_image":
                    _encode_image(
                        table_crop,
                        quality=86,
                    ),

                "ocr_width":
                    ocr_crop.width,

                "ocr_height":
                    ocr_crop.height,

                "table_width":
                    table_crop.width,

                "table_height":
                    table_crop.height,
            }
        )

    return {
        "filename":
            filename,

        "page_count":
            len(pages),

        "pages":
            pages,
    }
