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


def load_ibm_aml_sample(
    nrows: int = 50_000,
) -> tuple[pd.DataFrame, None]:
    """Load a sample of IBM AML data (merged single table, no accounts)."""
    df = pd.read_csv(IBM_AML_TRANS_PATH, nrows=nrows)
    return df, None


def load_channel_data(
    channel_keys: list[str],
    nrows: int | None = 50_000,
) -> tuple[pd.DataFrame, pd.DataFrame | None]:
    """Load transaction data for one or more channels.

    If multiple channels are selected, data is concatenated with a 'channel' column added.
    Also loads KYC individual data as the accounts table.
    """
    frames = []
    for key in channel_keys:
        if key not in CHANNELS:
            continue
        ch = CHANNELS[key]
        path = CHANNEL_DATA_DIR / ch["file"]
        if not path.exists():
            continue
        df = pd.read_csv(path, nrows=nrows)
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
