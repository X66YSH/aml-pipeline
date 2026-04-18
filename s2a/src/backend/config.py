"""Configuration for AML Multi-Agent App."""

import os
from pathlib import Path

from dotenv import load_dotenv

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
BACKEND_DIR = Path(__file__).resolve().parent
SRC_DIR = BACKEND_DIR.parent
APP_ROOT = SRC_DIR.parent  # app_tool/
PROJECT_ROOT = APP_ROOT.parent  # aml_next_gen/

UPLOADS_DIR = APP_ROOT / "uploads"
UPLOADS_DIR.mkdir(exist_ok=True)

RUNS_DIR = APP_ROOT / "runs"
RUNS_DIR.mkdir(exist_ok=True)

# FINTRAC channel data paths
CHANNEL_DATA_DIR = PROJECT_ROOT / "data"

# IBM AML data paths (merged single table)
IBM_AML_TRANS_PATH = CHANNEL_DATA_DIR / "ibm_aml.csv"

# FINTRAC PDF directory
FINTRAC_PDF_DIR = PROJECT_ROOT / "news_signal_opertaional_alerts"

# ---------------------------------------------------------------------------
# API keys
# ---------------------------------------------------------------------------
# Load .env from project root
_project_env = PROJECT_ROOT / ".env"
if _project_env.exists():
    load_dotenv(_project_env)

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

# ---------------------------------------------------------------------------
# LLM configuration
# ---------------------------------------------------------------------------
DEFAULT_LLM = "gpt-4o"
LLM_TEMPERATURE = 0
MAX_CORRECTION_ITERATIONS = 5
MAX_OUTPUT_TOKENS = 4096

# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------
CHUNK_SIZE = 100_000  # rows per chunk for large CSV processing
SCHEMA_SAMPLE_ROWS = 5  # rows to show in schema preview
VALIDATION_SAMPLE_SIZE = 50_000
FEATURE_TIMEOUT_SECONDS = 120

# ---------------------------------------------------------------------------
# Server
# ---------------------------------------------------------------------------
CORS_ORIGINS = [
    "http://localhost:5173",
    "http://localhost:3000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:3000",
]

# ---------------------------------------------------------------------------
# FINTRAC operational alert URLs (12 initiatives)
# ---------------------------------------------------------------------------
FINTRAC_BASE = "https://fintrac-canafe.canada.ca/intel/operation"

FINTRAC_INITIATIVES = {
    "professional_ml": {
        "name": "Professional Money Laundering (Trade & MSBs)",
        "url": f"{FINTRAC_BASE}/oai-ml-eng",
        "crime_type": "ML",
    },
    "human_trafficking_original": {
        "name": "Human Trafficking for Sexual Exploitation (original)",
        "url": f"{FINTRAC_BASE}/oai-hts-eng",
        "crime_type": "HT",
    },
    "human_trafficking_2021": {
        "name": "Human Trafficking for Sexual Exploitation (updated 2021)",
        "url": f"{FINTRAC_BASE}/oai-hts-2021-eng",
        "crime_type": "HT",
    },
    "terrorist_financing": {
        "name": "Terrorist Activity Financing",
        "url": f"{FINTRAC_BASE}/taf-eng",
        "crime_type": "TF",
    },
    "synthetic_opioids": {
        "name": "Illicit Synthetic Opioids / Fentanyl",
        "url": f"{FINTRAC_BASE}/iso-osi-eng",
        "crime_type": "Drugs",
    },
    "casino_banking": {
        "name": "Casino-Related Underground Banking",
        "url": f"{FINTRAC_BASE}/casino-eng",
        "crime_type": "ML",
    },
    "underground_banking": {
        "name": "Underground Banking Schemes (updated)",
        "url": f"{FINTRAC_BASE}/ml-rec-eng",
        "crime_type": "ML",
    },
    "tax_evasion_realestate": {
        "name": "Tax Evasion in Real Estate",
        "url": f"{FINTRAC_BASE}/tax-fiscale-eng",
        "crime_type": "Tax",
    },
    "wildlife_trade": {
        "name": "Illegal Wildlife Trade",
        "url": f"{FINTRAC_BASE}/oai-wildlife-eng",
        "crime_type": "Wildlife",
    },
    "child_exploitation": {
        "name": "Online Child Sexual Exploitation",
        "url": f"{FINTRAC_BASE}/exploitation-eng",
        "crime_type": "CSAM",
    },
    "romance_fraud": {
        "name": "Romance Fraud",
        "url": f"{FINTRAC_BASE}/rf-eng",
        "crime_type": "Fraud",
    },
    "dprk": {
        "name": "DPRK Financial System Abuse",
        "url": f"{FINTRAC_BASE}/oai-dprk-eng",
        "crime_type": "Sanctions",
    },
}

# Pre-loaded schema definitions
PRELOADED_SCHEMAS = {
    "ibm_aml": {
        "name": "IBM AML (Merged)",
        "description": "IBM AML synthetic dataset - 5M transactions, 496K unique sender accounts, merged single table",
        "tables": {
            "transactions": {
                "file": "ibm_aml.csv",
                "columns": [
                    "Timestamp", "Sender_Bank_ID", "Sender_Account",
                    "Receiver_Bank_ID", "Receiver_Account",
                    "Amount Received", "Receiving Currency", "Amount Paid",
                    "Payment Currency", "Payment Format", "Is Laundering",
                    "Sender_Bank_Name", "Sender_Country", "Sender_Entity",
                    "Receiver_Bank_Name", "Receiver_Country", "Receiver_Entity",
                ],
                "row_count": 5_078_415,
            },
        },
    },
}

# ---------------------------------------------------------------------------
# FINTRAC channel definitions
# ---------------------------------------------------------------------------
CHANNEL_COMMON_COLUMNS = [
    "transaction_id", "customer_id", "amount_cad", "debit_credit", "transaction_datetime",
]

CHANNELS = {
    "card": {
        "name": "Card (Credit/Debit)",
        "file": "card.csv",
        "extra_columns": ["merchant_category", "ecommerce_ind", "country", "province", "city"],
        "row_count": 3_553_304,
    },
    "eft": {
        "name": "EFT (Electronic Funds Transfer)",
        "file": "eft.csv",
        "extra_columns": [],
        "row_count": 1_070_699,
    },
    "emt": {
        "name": "EMT (e-Transfer)",
        "file": "emt.csv",
        "extra_columns": [],
        "row_count": 845_997,
    },
    "cheque": {
        "name": "Cheque",
        "file": "cheque.csv",
        "extra_columns": [],
        "row_count": 240_549,
    },
    "abm": {
        "name": "ABM (ATM)",
        "file": "abm.csv",
        "extra_columns": ["cash_indicator", "country", "province", "city"],
        "row_count": 185_691,
    },
    "wire": {
        "name": "Wire Transfer",
        "file": "wire.csv",
        "extra_columns": [],
        "row_count": 4_957,
    },
    "westernunion": {
        "name": "Western Union",
        "file": "westernunion.csv",
        "extra_columns": [],
        "row_count": 2_143,
    },
}

# KYC (Know Your Customer) tables
KYC_TABLES = {
    "kyc_individual": {
        "file": "kyc_individual.csv",
        "columns": [
            "customer_id", "country", "province", "city", "gender",
            "marital_status", "occupation_code", "income", "birth_date", "onboard_date",
        ],
        "row_count": 53_100,
    },
    "labels": {
        "file": "labels.csv",
        "columns": ["customer_id", "label"],
        "row_count": 1_001,
    },
}
