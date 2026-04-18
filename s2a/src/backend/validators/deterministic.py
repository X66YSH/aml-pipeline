"""Deterministic Validator -- pure Python, NOT an LLM agent.

Executes candidate feature code and enforces acceptance criteria.
This is the hard gate: LLMs propose, this validates.

Imported from s2f_signal_to_features with minor adaptations for the web app.

Validation pipeline (6 sequential checks):
1.  Syntax check -- compile via exec()
1.5 AST analysis -- static checks for banned imports/calls, I/O, complexity
2.  Function existence -- compute_feature defined
3.  Execution -- run on sample data, catch errors
4.  Output type -- must be a pandas DataFrame
5.  Output quality -- not empty, not all-NaN, not constant
"""

import time
from typing import Any

import numpy as np
import pandas as pd

from validators.ast_analyzer import analyze_code


class ValidationError:
    """Structured validation error for feedback to the Feature Engineer."""

    def __init__(self, error_type: str, message: str, stage: str):
        self.error_type = error_type
        self.message = message
        self.stage = stage

    def to_dict(self) -> dict:
        return {
            "error_type": self.error_type,
            "message": self.message,
            "stage": self.stage,
        }

    def __str__(self) -> str:
        return f"[{self.stage}] {self.error_type}: {self.message}"


class ValidationResult:
    """Result of the deterministic validation pipeline."""

    def __init__(
        self,
        success: bool,
        result_df: pd.DataFrame | None = None,
        error: "ValidationError | None" = None,
        stats: dict | None = None,
        runtime_seconds: float = 0.0,
    ):
        self.success = success
        self.result_df = result_df
        self.error = error
        self.stats = stats or {}
        self.runtime_seconds = runtime_seconds

    def to_dict(self) -> dict:
        d = {
            "success": self.success,
            "runtime_seconds": round(self.runtime_seconds, 3),
        }
        if self.error:
            d["error"] = self.error.to_dict()
        if self.stats:
            d["stats"] = self.stats
        return d


def validate_feature(
    code_str: str,
    df: pd.DataFrame,
    accounts_df: pd.DataFrame | None = None,
    timeout_seconds: int = 120,
) -> ValidationResult:
    """Run the full 6-stage validation pipeline.

    Args:
        code_str: Python source code defining compute_feature().
        df: Transaction DataFrame (sample).
        accounts_df: Accounts DataFrame (for IBM AML schema).
        timeout_seconds: Max execution time.

    Returns:
        ValidationResult with success flag, output, or structured error.
    """
    start = time.time()

    # --- Stage 1: Syntax check ---
    try:
        exec_globals: dict[str, Any] = {"pd": pd, "np": np}
        exec(code_str, exec_globals)
    except SyntaxError as e:
        return ValidationResult(
            success=False,
            error=ValidationError("syntax_error", f"SyntaxError: {e}", "compile"),
            runtime_seconds=time.time() - start,
        )

    # --- Stage 1.5: AST complexity analysis ---
    ast_result = analyze_code(code_str)
    ast_warnings = [f.to_dict() for f in ast_result.warnings]

    if not ast_result.passed:
        error_details = "; ".join(f.message for f in ast_result.errors)
        return ValidationResult(
            success=False,
            error=ValidationError(
                "ast_analysis_failed",
                f"AST static analysis blocked: {error_details}",
                "ast_analysis",
            ),
            stats={"ast_warnings": ast_warnings},
            runtime_seconds=time.time() - start,
        )

    # --- Stage 2: Function existence ---
    if "compute_feature" not in exec_globals:
        return ValidationResult(
            success=False,
            error=ValidationError(
                "missing_function",
                "compute_feature not found in exec namespace",
                "function_check",
            ),
            runtime_seconds=time.time() - start,
        )
    compute_fn = exec_globals["compute_feature"]

    # --- Stage 3: Execution ---
    try:
        if accounts_df is not None:
            result = compute_fn(df.copy(), accounts_df.copy())
        else:
            result = compute_fn(df.copy())
    except KeyError as e:
        return ValidationResult(
            success=False,
            error=ValidationError("missing_column", f"KeyError: {e}", "execution"),
            runtime_seconds=time.time() - start,
        )
    except TypeError as e:
        return ValidationResult(
            success=False,
            error=ValidationError("type_error", f"TypeError: {e}", "execution"),
            runtime_seconds=time.time() - start,
        )
    except Exception as e:
        return ValidationResult(
            success=False,
            error=ValidationError(
                "runtime_error",
                f"{type(e).__name__}: {e}",
                "execution",
            ),
            runtime_seconds=time.time() - start,
        )

    # --- Stage 4: Output type ---
    if not isinstance(result, pd.DataFrame):
        return ValidationResult(
            success=False,
            error=ValidationError(
                "wrong_output_type",
                f"Expected DataFrame, got {type(result)}",
                "type_check",
            ),
            runtime_seconds=time.time() - start,
        )

    # --- Stage 5: Output quality ---
    if len(result) == 0:
        return ValidationResult(
            success=False,
            error=ValidationError("empty_output", "Empty result (0 rows)", "quality"),
            runtime_seconds=time.time() - start,
        )

    numeric_cols = result.select_dtypes(include=[np.number])
    if len(numeric_cols.columns) == 0:
        return ValidationResult(
            success=False,
            error=ValidationError(
                "no_numeric_output",
                "No numeric columns in output",
                "quality",
            ),
            runtime_seconds=time.time() - start,
        )

    feature_col = numeric_cols.columns[0]
    vals = result[feature_col].dropna()

    if len(vals) == 0:
        return ValidationResult(
            success=False,
            error=ValidationError("all_nan", "All feature values are NaN", "quality"),
            runtime_seconds=time.time() - start,
        )

    if vals.nunique() <= 1 and len(vals) > 10:
        return ValidationResult(
            success=False,
            error=ValidationError(
                "constant_output",
                f"Constant output ({vals.iloc[0]}) -- too permissive or too restrictive",
                "quality",
            ),
            runtime_seconds=time.time() - start,
        )

    # --- PASS ---
    elapsed = time.time() - start
    stats = {
        "n_accounts": len(result),
        "nonzero_pct": round(float((vals != 0).mean() * 100), 1),
        "mean": round(float(vals.mean()), 4),
        "std": round(float(vals.std()), 4),
        "min": round(float(vals.min()), 4),
        "max": round(float(vals.max()), 4),
    }
    if ast_warnings:
        stats["ast_warnings"] = ast_warnings

    return ValidationResult(
        success=True,
        result_df=result,
        stats=stats,
        runtime_seconds=elapsed,
    )
