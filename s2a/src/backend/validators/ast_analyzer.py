"""AST Complexity Analyzer -- static analysis for generated feature code.

Pure Python module using stdlib `ast`. Catches security risks, I/O violations,
and performance anti-patterns BEFORE code execution.

Imported from s2f_signal_to_features without modification.
"""

import ast
from dataclasses import dataclass, field
from enum import Enum


class Severity(str, Enum):
    ERROR = "error"
    WARNING = "warning"


@dataclass
class ASTFinding:
    """A single issue found during AST analysis."""

    severity: Severity
    category: str
    rule: str
    message: str
    line: int | None = None

    def to_dict(self) -> dict:
        return {
            "severity": self.severity.value,
            "category": self.category,
            "rule": self.rule,
            "message": self.message,
            "line": self.line,
        }


@dataclass
class ASTAnalysisResult:
    """Aggregate result of all AST checks."""

    passed: bool
    findings: list[ASTFinding] = field(default_factory=list)

    @property
    def errors(self) -> list[ASTFinding]:
        return [f for f in self.findings if f.severity == Severity.ERROR]

    @property
    def warnings(self) -> list[ASTFinding]:
        return [f for f in self.findings if f.severity == Severity.WARNING]

    def to_dict(self) -> dict:
        return {
            "passed": self.passed,
            "n_errors": len(self.errors),
            "n_warnings": len(self.warnings),
            "findings": [f.to_dict() for f in self.findings],
        }


# ---------------------------------------------------------------------------
# Rule definitions
# ---------------------------------------------------------------------------

BANNED_IMPORTS = frozenset({
    "os", "sys", "subprocess", "shutil", "pathlib",
    "socket", "http", "urllib", "requests", "httpx",
    "ftplib", "smtplib", "telnetlib",
    "pickle", "shelve", "marshal",
    "ctypes", "multiprocessing", "threading",
})

BANNED_CALLS = frozenset({
    "eval", "exec", "open", "compile",
    "__import__", "globals", "locals",
    "getattr", "setattr", "delattr",
})

FILE_IO_ATTRS = frozenset({
    "read_csv", "to_csv", "read_excel", "to_excel",
    "read_parquet", "to_parquet", "read_json", "to_json",
    "read_sql", "to_sql", "read_hdf", "to_hdf",
    "read_pickle", "to_pickle", "read_feather", "to_feather",
})

NETWORK_ATTRS = frozenset({
    "get", "post", "put", "delete", "patch",
    "urlopen", "urlretrieve",
    "connect", "sendall", "recv",
})

SLOW_PANDAS_ATTRS = frozenset({
    "iterrows", "itertuples",
})


# ---------------------------------------------------------------------------
# AST Visitor
# ---------------------------------------------------------------------------

class _ColumnExtractor(ast.NodeVisitor):
    """Extract column references from source DataFrames only.

    Only tracks columns accessed on the function parameters (df, accounts_df),
    not on derived/intermediate DataFrames. This prevents false positives
    when code creates derived columns like df['new_col'] = expr.
    """

    # Names of the input DataFrame parameters
    INPUT_DF_NAMES = {"df", "accounts_df"}

    def __init__(self) -> None:
        self.columns: set[str] = set()
        self._assigned_columns: set[str] = set()

    def visit_Assign(self, node: ast.Assign) -> None:
        # Track columns on the LEFT side of assignment: df['new_col'] = ...
        for target in node.targets:
            if isinstance(target, ast.Subscript):
                if isinstance(target.slice, ast.Constant) and isinstance(target.slice.value, str):
                    self._assigned_columns.add(target.slice.value)
        self.generic_visit(node)

    def _is_input_df(self, node: ast.expr) -> bool:
        """Check if the subscript target is one of the input DataFrames."""
        if isinstance(node, ast.Name) and node.id in self.INPUT_DF_NAMES:
            return True
        return False

    def visit_Subscript(self, node: ast.Subscript) -> None:
        # Only track column refs on input DataFrames (df, accounts_df)
        if self._is_input_df(node.value):
            if isinstance(node.slice, ast.Constant) and isinstance(node.slice.value, str):
                self.columns.add(node.slice.value)
            elif isinstance(node.slice, ast.List):
                for elt in node.slice.elts:
                    if isinstance(elt, ast.Constant) and isinstance(elt.value, str):
                        self.columns.add(elt.value)
        self.generic_visit(node)

    def get_read_columns(self) -> set[str]:
        """Return columns read from input DataFrames, excluding assigned ones."""
        return self.columns - self._assigned_columns


def extract_column_refs(code_str: str) -> set[str]:
    """Extract column references that are READ from the source data.

    Columns created by assignment (df['new_col'] = ...) are excluded
    because they don't need to exist in the source schema.
    """
    try:
        tree = ast.parse(code_str)
    except SyntaxError:
        return set()
    visitor = _ColumnExtractor()
    visitor.visit(tree)
    return visitor.get_read_columns()


def validate_columns(code_str: str, schema_columns: list[str]) -> ASTAnalysisResult:
    """Check that all column references in code exist in the schema."""
    referenced = extract_column_refs(code_str)
    schema_set = set(schema_columns)
    # Also allow common computed columns (e.g. 'channel' which is added at runtime)
    schema_set.add("channel")

    findings: list[ASTFinding] = []
    unknown = sorted(referenced - schema_set)
    for col in unknown:
        findings.append(ASTFinding(
            severity=Severity.ERROR,
            category="unknown_column",
            rule=f"col_{col}",
            message=f"Column '{col}' not found in dataset schema. Available columns: {', '.join(sorted(schema_set))}",
        ))

    return ASTAnalysisResult(
        passed=len(findings) == 0,
        findings=findings,
    )


class _FeatureCodeVisitor(ast.NodeVisitor):
    """Walk the AST and collect findings."""

    def __init__(self) -> None:
        self.findings: list[ASTFinding] = []
        self._defined_functions: set[str] = set()
        self._loop_depth: int = 0

    def visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            top_module = alias.name.split(".")[0]
            if top_module in BANNED_IMPORTS:
                self.findings.append(ASTFinding(
                    severity=Severity.ERROR,
                    category="banned_import",
                    rule=f"import_{top_module}",
                    message=f"Banned import: '{alias.name}' -- feature code must not import system/IO/network modules",
                    line=node.lineno,
                ))
        self.generic_visit(node)

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        if node.module:
            top_module = node.module.split(".")[0]
            if top_module in BANNED_IMPORTS:
                self.findings.append(ASTFinding(
                    severity=Severity.ERROR,
                    category="banned_import",
                    rule=f"from_{top_module}",
                    message=f"Banned import: 'from {node.module} import ...' -- feature code must not import system/IO/network modules",
                    line=node.lineno,
                ))
        self.generic_visit(node)

    def visit_Call(self, node: ast.Call) -> None:
        if isinstance(node.func, ast.Name) and node.func.id in BANNED_CALLS:
            self.findings.append(ASTFinding(
                severity=Severity.ERROR,
                category="banned_call",
                rule=f"call_{node.func.id}",
                message=f"Banned call: '{node.func.id}()' -- not allowed in feature code",
                line=node.lineno,
            ))

        if isinstance(node.func, ast.Attribute):
            attr = node.func.attr

            if attr in FILE_IO_ATTRS:
                self.findings.append(ASTFinding(
                    severity=Severity.ERROR,
                    category="file_io",
                    rule=f"io_{attr}",
                    message=f"File I/O detected: '.{attr}()' -- feature code must not perform file operations",
                    line=node.lineno,
                ))

            if attr in NETWORK_ATTRS:
                self.findings.append(ASTFinding(
                    severity=Severity.ERROR,
                    category="network_call",
                    rule=f"net_{attr}",
                    message=f"Potential network call: '.{attr}()' -- feature code must not make external calls",
                    line=node.lineno,
                ))

            if attr in SLOW_PANDAS_ATTRS:
                self.findings.append(ASTFinding(
                    severity=Severity.WARNING,
                    category="slow_pattern",
                    rule=f"pandas_{attr}",
                    message=f"Slow pandas pattern: '.{attr}()' -- consider vectorized operations",
                    line=node.lineno,
                ))

            if attr == "merge":
                self._check_cross_merge(node)

            if attr == "apply":
                self._check_apply_lambda(node)

        if isinstance(node.func, ast.Name) and node.func.id == "merge":
            self._check_cross_merge(node)

        self.generic_visit(node)

    def _check_cross_merge(self, node: ast.Call) -> None:
        for kw in node.keywords:
            if kw.arg == "how" and isinstance(kw.value, ast.Constant) and kw.value.value == "cross":
                self.findings.append(ASTFinding(
                    severity=Severity.ERROR,
                    category="cross_merge",
                    rule="merge_cross",
                    message="Cross merge detected (how='cross') -- Cartesian join causes O(n^2) explosion",
                    line=node.lineno,
                ))

    def _check_apply_lambda(self, node: ast.Call) -> None:
        if node.args and isinstance(node.args[0], ast.Lambda):
            self.findings.append(ASTFinding(
                severity=Severity.WARNING,
                category="slow_pattern",
                rule="apply_lambda",
                message=".apply(lambda ...) -- often slow, consider vectorized alternative",
                line=node.lineno,
            ))

    def visit_For(self, node: ast.For) -> None:
        self._loop_depth += 1
        if self._loop_depth >= 2:
            self.findings.append(ASTFinding(
                severity=Severity.WARNING,
                category="complexity",
                rule="nested_loop",
                message=f"Nested for-loop (depth={self._loop_depth}) -- O(n^{self._loop_depth}) risk",
                line=node.lineno,
            ))
        self.generic_visit(node)
        self._loop_depth -= 1

    def visit_While(self, node: ast.While) -> None:
        self._loop_depth += 1
        if self._loop_depth >= 2:
            self.findings.append(ASTFinding(
                severity=Severity.WARNING,
                category="complexity",
                rule="nested_loop",
                message=f"Nested loop (depth={self._loop_depth}) -- O(n^{self._loop_depth}) risk",
                line=node.lineno,
            ))
        self.generic_visit(node)
        self._loop_depth -= 1

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        self._defined_functions.add(node.name)
        for child in ast.walk(node):
            if (
                isinstance(child, ast.Call)
                and isinstance(child.func, ast.Name)
                and child.func.id == node.name
            ):
                self.findings.append(ASTFinding(
                    severity=Severity.WARNING,
                    category="recursion",
                    rule="recursive_call",
                    message=f"Recursive call to '{node.name}()' -- stack overflow risk on large data",
                    line=child.lineno,
                ))
                break
        self.generic_visit(node)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def analyze_code(code_str: str) -> ASTAnalysisResult:
    """Run all AST checks on generated feature code."""
    try:
        tree = ast.parse(code_str)
    except SyntaxError:
        return ASTAnalysisResult(passed=True, findings=[])

    visitor = _FeatureCodeVisitor()
    visitor.visit(tree)

    has_errors = any(f.severity == Severity.ERROR for f in visitor.findings)

    return ASTAnalysisResult(
        passed=not has_errors,
        findings=visitor.findings,
    )
