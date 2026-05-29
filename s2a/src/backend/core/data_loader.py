"""Dataset loading utilities -- chunked reads for the web app.

Supports IBM AML data (legacy) and FINTRAC channel data.
"""

from pathlib import Path

import pandas as pd

from config import (
    CHANNEL_COMMON_COLUMNS,
    CHANNEL_DATA_DIR,
    CHANNELS,
    CHUNK_SIZE,
    IBM_AML_TRANS_PATH,
    KYC_TABLES,
    SCHEMA_SAMPLE_ROWS,
)


def _count_csv_rows(path: Path) -> int:
    """Count CSV data rows (excluding header) without loading into memory.

    Uses buffered binary read — typically < 0.3 s for a 500 MB file.
    Returns 0 if the file is empty or has only a header row.
    """
    with open(path, "rb") as f:
        n_newlines = sum(
            buf.count(b"\n")
            for buf in iter(lambda: f.read(1 << 20), b"")
        )
    return max(0, n_newlines - 1)  # subtract the header row's newline


def load_ibm_aml_sample(
    nrows: int = 50_000,
) -> tuple[pd.DataFrame, None]:
    """Load a sample of IBM AML data (merged single table, no accounts)."""
    df = pd.read_csv(IBM_AML_TRANS_PATH, nrows=nrows)
    return df, None


def load_channel_data(
    channel_keys: list[str],
    nrows: int | None = 50_000,
    random_state: int | None = None,
) -> tuple[pd.DataFrame, pd.DataFrame | None]:
    """Load transaction data for one or more channels.

    If multiple channels are selected, data is concatenated with a 'channel'
    column added.  Also loads KYC individual data as the accounts table.

    Parameters
    ----------
    channel_keys : list[str]
        Channel keys to load (must exist in ``CHANNELS``).
    nrows : int | None
        Maximum number of rows to load.  ``None`` loads the full file.
    random_state : int | None
        When provided, draws a proportionally random sample of ``nrows`` rows
        spread uniformly across the *entire* file rather than reading the first
        ``nrows`` rows.  This removes the head-of-file time-window bias that
        inflates KS/IV statistics during feature evaluation and model training.

        Pass ``None`` (default) to keep the original head behaviour, which is
        appropriate for schema previews and small diagnostic reads where recency
        context is acceptable.

    Implementation note
    -------------------
    Random sampling is done in a single streaming pass:
    1. Binary line-count to determine the total number of data rows.
    2. Chunked read (``CHUNK_SIZE`` rows per chunk); each chunk is sampled at
       ``frac = nrows / total_rows`` using the caller-supplied ``random_state``.
    3. The combined sample is trimmed to exactly ``nrows`` if rounding causes
       a minor overshoot.

    Peak memory is bounded by ``max(CHUNK_SIZE, nrows)`` rows — the same order
    of magnitude as the head-based approach but representative of the full
    dataset's time range.
    """
    frames = []
    for key in channel_keys:
        if key not in CHANNELS:
            continue
        ch = CHANNELS[key]
        path = CHANNEL_DATA_DIR / ch["file"]
        if not path.exists():
            continue

        if nrows is None or random_state is None:
            # Original behaviour: head of file (fast, recency-biased).
            df = pd.read_csv(path, nrows=nrows)
        else:
            total_rows = _count_csv_rows(path)
            if total_rows <= nrows:
                # File is smaller than the cap — load everything.
                df = pd.read_csv(path)
            else:
                frac = nrows / total_rows
                sampled_chunks: list[pd.DataFrame] = []
                for chunk in pd.read_csv(path, chunksize=CHUNK_SIZE):
                    sampled_chunks.append(
                        chunk.sample(frac=frac, random_state=random_state)
                    )
                df = pd.concat(sampled_chunks, ignore_index=True)
                # Trim to exact target in case fractional rounding overshot.
                if len(df) > nrows:
                    df = df.sample(n=nrows, random_state=random_state)

        df["channel"] = key
        frames.append(df)

    if not frames:
        raise FileNotFoundError(f"No data files found for channels: {channel_keys}")

    combined = pd.concat(frames, ignore_index=True)

    # Load KYC individual as accounts table
    kyc_path = CHANNEL_DATA_DIR / KYC_TABLES["kyc_individual"]["file"]
    accounts_df = None
    if kyc_path.exists():
        accounts_df = pd.read_csv(kyc_path)

    return combined, accounts_df


def load_labels() -> pd.DataFrame:
    """Load the labels table (customer_id, label)."""
    path = CHANNEL_DATA_DIR / KYC_TABLES["labels"]["file"]
    return pd.read_csv(path)


def load_uploaded_csv(
    file_path: Path,
    nrows: int | None = None,
) -> pd.DataFrame:
    """Load an uploaded CSV file with optional row limit."""
    return pd.read_csv(file_path, nrows=nrows)


def get_schema_info(df: pd.DataFrame, name: str = "table") -> dict:
    """Extract schema information from a DataFrame."""
    # fillna to avoid JSON serialization errors with NaN
    sample_df = df.head(SCHEMA_SAMPLE_ROWS).fillna("")
    return {
        "table_name": name,
        "columns": list(df.columns),
        "dtypes": {col: str(df[col].dtype) for col in df.columns},
        "shape": list(df.shape),
        "sample": sample_df.to_dict(orient="records"),
        "null_counts": {k: int(v) for k, v in df.isnull().sum().to_dict().items()},
    }


def detect_schema(df: pd.DataFrame) -> dict:
    """Detect the schema type of an uploaded CSV."""
    columns = set(df.columns)

    # Check FINTRAC channel format
    channel_cols = set(CHANNEL_COMMON_COLUMNS)
    channel_overlap = len(columns & channel_cols) / len(channel_cols)

    ibm_aml_cols = {
        "Timestamp", "Sender_Bank_ID", "Sender_Account",
        "Receiver_Bank_ID", "Receiver_Account",
        "Amount Received", "Receiving Currency", "Amount Paid",
        "Payment Currency", "Payment Format", "Is Laundering",
        "Sender_Bank_Name", "Sender_Country", "Sender_Entity",
        "Receiver_Bank_Name", "Receiver_Country", "Receiver_Entity",
    }

    ibm_overlap = len(columns & ibm_aml_cols) / len(ibm_aml_cols)

    if channel_overlap > 0.8:
        match_type = "fintrac_channel"
        confidence = channel_overlap
    elif ibm_overlap > 0.7:
        match_type = "ibm_aml"
        confidence = ibm_overlap
    else:
        match_type = "unknown"
        confidence = max(ibm_overlap, channel_overlap)

    return {
        "detected_schema": match_type,
        "confidence": round(confidence, 2),
        "schema_info": get_schema_info(df, match_type),
    }
