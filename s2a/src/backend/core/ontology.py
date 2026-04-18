"""Indicator ontology -- fixed categories that all indicators must map to.

Imported from s2f_signal_to_features. 20 categories covering FINTRAC typologies.
"""

from enum import Enum


class IndicatorCategory(str, Enum):
    """Fixed set of indicator categories.

    Every extracted indicator MUST map to one of these.
    This prevents the LLM from inventing ad-hoc categories.
    """

    # --- v1 categories ---
    STRUCTURING = "structuring"
    LAYERING = "layering"
    VELOCITY_ANOMALY = "velocity_anomaly"
    GEOGRAPHIC_RISK = "geographic_risk"
    COUNTERPARTY_RISK = "counterparty_risk"
    TEMPORAL_ANOMALY = "temporal_anomaly"
    AMOUNT_ANOMALY = "amount_anomaly"
    NETWORK_ANOMALY = "network_anomaly"
    BEHAVIORAL_CHANGE = "behavioral_change"
    DOCUMENTATION_GAP = "documentation_gap"

    # --- v2 additions (FINTRAC-driven) ---
    PASS_THROUGH = "pass_through"
    TRADE_BASED = "trade_based"
    VIRTUAL_CURRENCY = "virtual_currency"
    CASH_INTENSIVE = "cash_intensive"
    NOMINEE_USE = "nominee_use"
    RAPID_MOVEMENT = "rapid_movement"
    SANCTIONS_EVASION = "sanctions_evasion"
    LIFESTYLE_INCONSISTENCY = "lifestyle_inconsistency"
    CURRENCY_ANOMALY = "currency_anomaly"
    COMMINGLING = "commingling"


CATEGORY_DESCRIPTIONS: dict[str, str] = {
    IndicatorCategory.STRUCTURING: (
        "Breaking amounts to avoid reporting thresholds "
        "(e.g., CTR at $10K, FINTRAC at $10K CAD)"
    ),
    IndicatorCategory.LAYERING: (
        "Complex transaction chains to obscure origin of funds"
    ),
    IndicatorCategory.VELOCITY_ANOMALY: (
        "Unusual transaction frequency for account profile"
    ),
    IndicatorCategory.GEOGRAPHIC_RISK: (
        "Involvement of high-risk jurisdictions (FATF list)"
    ),
    IndicatorCategory.COUNTERPARTY_RISK: (
        "Transactions with high-risk entities or accounts"
    ),
    IndicatorCategory.TEMPORAL_ANOMALY: (
        "Unusual timing patterns (off-hours, clustering)"
    ),
    IndicatorCategory.AMOUNT_ANOMALY: (
        "Unusual amounts (round numbers, inconsistent with profile)"
    ),
    IndicatorCategory.NETWORK_ANOMALY: (
        "Unusual relationship structures (fan-in, fan-out, cycles)"
    ),
    IndicatorCategory.BEHAVIORAL_CHANGE: (
        "Significant deviation from historical account behavior"
    ),
    IndicatorCategory.DOCUMENTATION_GAP: (
        "Missing or inadequate KYC/transaction documentation"
    ),
    IndicatorCategory.PASS_THROUGH: (
        "Flow-through / funnel accounts where funds enter and leave quickly "
        "with matching in/out volumes"
    ),
    IndicatorCategory.TRADE_BASED: (
        "Trade-based money laundering via over/under-invoicing, "
        "phantom shipments, or multiple invoicing"
    ),
    IndicatorCategory.VIRTUAL_CURRENCY: (
        "Cryptocurrency or virtual asset transactions used to "
        "obscure fund origins or move value across borders"
    ),
    IndicatorCategory.CASH_INTENSIVE: (
        "Unusual patterns of cash deposits, withdrawals, or exchanges "
        "inconsistent with stated business type"
    ),
    IndicatorCategory.NOMINEE_USE: (
        "Use of nominees, shell entities, or third parties to "
        "distance beneficial owner from transactions"
    ),
    IndicatorCategory.RAPID_MOVEMENT: (
        "Quick in-and-out fund movement -- deposits followed by "
        "immediate outgoing transfers"
    ),
    IndicatorCategory.SANCTIONS_EVASION: (
        "Patterns suggesting circumvention of sanctions regimes "
        "(e.g., DPRK, Iran)"
    ),
    IndicatorCategory.LIFESTYLE_INCONSISTENCY: (
        "Transaction activity inconsistent with customer profile, "
        "stated occupation, or income level"
    ),
    IndicatorCategory.CURRENCY_ANOMALY: (
        "Unusual currency conversion patterns, mismatched payment/receiving "
        "currencies, or unnecessary foreign exchange transactions"
    ),
    IndicatorCategory.COMMINGLING: (
        "Mixing personal and business funds, or combining licit and illicit "
        "proceeds in the same accounts"
    ),
}

ALLOWED_OPERATIONS = [
    "count", "sum", "mean", "std", "max", "min",
    "ratio", "entropy", "distinct_count",
    "coefficient_of_variation", "percentile", "frequency",
]
