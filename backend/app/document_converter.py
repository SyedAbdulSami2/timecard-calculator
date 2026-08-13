from __future__ import annotations

import base64
import io
from pathlib import Path
from typing import Any

import fitz
from PIL import (
    Image,
    ImageEnhance,
    ImageFilter,
    ImageOps,
)


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


# ============================================================
# IMAGE / OCR SETTINGS
# ============================================================

# Smaller preview image returned to frontend.
FULL_PAGE_MAX_WIDTH = 1600

# High-resolution OCR image.
OCR_MAX_WIDTH = 3200

# Tighter timecard-table OCR image.
TABLE_MAX_WIDTH = 3400

# Roughly 300 DPI for common PDF pages.
PDF_SCALE = 3.2

# Preview can remain JPEG.
PREVIEW_JPEG_QUALITY = 82


# ============================================================
# ENCODING
# ============================================================

def _encode_jpeg(
    image: Image.Image,
    quality: int = PREVIEW_JPEG_QUALITY,
) -> str:
    """
    Encode normal preview image as JPEG.
    """

    buffer = io.BytesIO()

    image.convert("RGB").save(
        buffer,
        format="JPEG",
        quality=quality,
        optimize=True,
        subsampling=0,
    )

    encoded = base64.b64encode(
        buffer.getvalue()
    ).decode("ascii")

    return (
        "data:image/jpeg;base64,"
        + encoded
    )


def _encode_png(
    image: Image.Image,
) -> str:
    """
    OCR images are returned as PNG.

    PNG avoids JPEG artifacts around:
    - digits
    - colons
    - handwriting
    - table borders
    """

    buffer = io.BytesIO()

    image.save(
        buffer,
        format="PNG",
        optimize=True,
    )

    encoded = base64.b64encode(
        buffer.getvalue()
    ).decode("ascii")

    return (
        "data:image/png;base64,"
        + encoded
    )


# ============================================================
# RESIZE HELPERS
# ============================================================

def _resize_to_width(
    image: Image.Image,
    max_width: int,
) -> Image.Image:
    width, height = image.size

    if width <= max_width:
        return image.copy()

    scale = (
        max_width
        / width
    )

    new_height = max(
        1,
        round(
            height
            * scale
        ),
    )

    return image.resize(
        (
            max_width,
            new_height,
        ),
        Image.Resampling.LANCZOS,
    )


def _upscale_to_width(
    image: Image.Image,
    target_width: int,
) -> Image.Image:
    """
    Unlike _resize_to_width(), this can enlarge
    smaller scanned/photo documents for OCR.
    """

    width, height = image.size

    if width <= 0:
        return image.copy()

    if width >= target_width:
        return _resize_to_width(
            image,
            target_width,
        )

    scale = (
        target_width
        / width
    )

    new_height = max(
        1,
        round(
            height
            * scale
        ),
    )

    return image.resize(
        (
            target_width,
            new_height,
        ),
        Image.Resampling.LANCZOS,
    )


# ============================================================
# FULL PAGE PREVIEW
# ============================================================

def _prepare_full_page(
    image: Image.Image,
) -> Image.Image:
    image = ImageOps.exif_transpose(
        image
    )

    image = image.convert(
        "RGB"
    )

    image = _resize_to_width(
        image,
        FULL_PAGE_MAX_WIDTH,
    )

    return image


# ============================================================
# OCR IMAGE PREPARATION
# ============================================================

def _prepare_ocr_image(
    image: Image.Image,
    target_width: int = OCR_MAX_WIDTH,
) -> Image.Image:
    """
    Produce a high-resolution OCR image.

    Important:
    - no hard black/white threshold
    - no JPEG compression
    - preserve thin digits and punctuation
    - mild contrast only
    """

    image = ImageOps.exif_transpose(
        image
    )

    image = image.convert(
        "L"
    )

    image = _upscale_to_width(
        image,
        target_width,
    )

    # Mild denoise first.
    image = image.filter(
        ImageFilter.MedianFilter(
            size=3
        )
    )

    # Moderate contrast.
    image = ImageEnhance.Contrast(
        image
    ).enhance(
        1.35
    )

    # Moderate sharpening.
    image = ImageEnhance.Sharpness(
        image
    ).enhance(
        1.45
    )

    # Unsharp mask helps handwritten numbers
    # without destroying punctuation.
    image = image.filter(
        ImageFilter.UnsharpMask(
            radius=1.2,
            percent=135,
            threshold=3,
        )
    )

    return image


# ============================================================
# OCR FULL PAGE
# ============================================================

def _create_full_ocr_image(
    image: Image.Image,
) -> Image.Image:
    """
    OCR the full document.

    Keeping the whole page is important because
    employee/week/date information can appear above
    the working-hours table.
    """

    return _prepare_ocr_image(
        image,
        target_width=OCR_MAX_WIDTH,
    )


# ============================================================
# GENERAL TIMECARD CROP
# ============================================================

def _create_timecard_crop(
    image: Image.Image,
) -> Image.Image:
    """
    Broad crop around the timecard's work-hour area.

    Deliberately conservative:
    we keep more of the page than before so that
    weekday/date labels are not accidentally removed.
    """

    width, height = image.size

    left = int(
        width * 0.01
    )

    right = int(
        width * 0.99
    )

    # Keep some header information.
    top = int(
        height * 0.08
    )

    # Remove only the lowest footer/signature area.
    bottom = int(
        height * 0.82
    )

    if (
        right <= left
        or bottom <= top
    ):
        cropped = image.copy()

    else:
        cropped = image.crop(
            (
                left,
                top,
                right,
                bottom,
            )
        )

    return _prepare_ocr_image(
        cropped,
        target_width=OCR_MAX_WIDTH,
    )


# ============================================================
# TABLE-FOCUSED CROP
# ============================================================

def _create_center_table_crop(
    image: Image.Image,
) -> Image.Image:
    """
    Higher resolution crop focused on the main
    regular-hours table.

    This is useful for detecting:
    - date
    - clock in
    - clock out
    - break
    - printed daily hours
    """

    width, height = image.size

    left = int(
        width * 0.005
    )

    right = int(
        width * 0.995
    )

    top = int(
        height * 0.16
    )

    bottom = int(
        height * 0.68
    )

    if (
        right <= left
        or bottom <= top
    ):
        cropped = image.copy()

    else:
        cropped = image.crop(
            (
                left,
                top,
                right,
                bottom,
            )
        )

    return _prepare_ocr_image(
        cropped,
        target_width=TABLE_MAX_WIDTH,
    )


# ============================================================
# OPTIONAL UPPER TABLE CROP
# ============================================================

def _create_upper_table_crop(
    image: Image.Image,
) -> Image.Image:
    """
    Additional crop that keeps the upper half of the
    document.

    Useful when the main regular-hours table begins
    very high on the page.
    """

    width, height = image.size

    left = int(
        width * 0.005
    )

    right = int(
        width * 0.995
    )

    top = int(
        height * 0.05
    )

    bottom = int(
        height * 0.55
    )

    if (
        right <= left
        or bottom <= top
    ):
        cropped = image.copy()

    else:
        cropped = image.crop(
            (
                left,
                top,
                right,
                bottom,
            )
        )

    return _prepare_ocr_image(
        cropped,
        target_width=TABLE_MAX_WIDTH,
    )


# ============================================================
# IMAGE FILE LOADING
# ============================================================

def _load_image_pages(
    data: bytes,
) -> list[Image.Image]:
    try:
        image = Image.open(
            io.BytesIO(
                data
            )
        )

    except Exception as exc:
        raise ValueError(
            f"Could not open image: {exc}"
        ) from exc

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

            # Preserve maximum source resolution.
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
# PDF LOADING
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

    # Much higher resolution than 1.8.
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
                colorspace=fitz.csRGB,
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

            del image
            del pixmap

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

    pages: list[
        dict[str, Any]
    ] = []

    for index, source in enumerate(
        source_pages
    ):
        full_page = (
            _prepare_full_page(
                source
            )
        )

        full_ocr = (
            _create_full_ocr_image(
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

        upper_table_crop = (
            _create_upper_table_crop(
                source
            )
        )

        pages.append(
            {
                "page_number":
                    index + 1,

                # Preview dimensions
                "width":
                    full_page.width,

                "height":
                    full_page.height,

                # Original source dimensions
                "source_width":
                    source.width,

                "source_height":
                    source.height,

                # ------------------------------------
                # Preview
                # ------------------------------------
                "image":
                    _encode_jpeg(
                        full_page,
                        quality=82,
                    ),

                # ------------------------------------
                # Full high-resolution OCR image
                # ------------------------------------
                "full_ocr_image":
                    _encode_png(
                        full_ocr
                    ),

                # ------------------------------------
                # Broad timecard OCR crop
                # ------------------------------------
                "ocr_image":
                    _encode_png(
                        ocr_crop
                    ),

                # ------------------------------------
                # Main regular-hours table crop
                # ------------------------------------
                "table_image":
                    _encode_png(
                        table_crop
                    ),

                # ------------------------------------
                # Additional upper table crop
                # ------------------------------------
                "upper_table_image":
                    _encode_png(
                        upper_table_crop
                    ),

                "full_ocr_width":
                    full_ocr.width,

                "full_ocr_height":
                    full_ocr.height,

                "ocr_width":
                    ocr_crop.width,

                "ocr_height":
                    ocr_crop.height,

                "table_width":
                    table_crop.width,

                "table_height":
                    table_crop.height,

                "upper_table_width":
                    upper_table_crop.width,

                "upper_table_height":
                    upper_table_crop.height,
            }
        )

    return {
        "filename":
            filename,

        "page_count":
            len(
                pages
            ),

        "pages":
            pages,
    }
