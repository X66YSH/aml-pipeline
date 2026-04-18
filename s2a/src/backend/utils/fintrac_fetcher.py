"""FINTRAC document fetcher -- HTML -> clean text + deterministic indicator extraction.

Imported from s2f_signal_to_features without modification.
"""

import re

import requests
from bs4 import BeautifulSoup


def fetch_fintrac_document(url: str) -> dict:
    """Fetch and parse a FINTRAC operational alert.

    Args:
        url: Full URL of the FINTRAC document.

    Returns:
        Dict with 'title', 'url', 'full_text', 'sections', and 'candidate_indicators'.
    """
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/131.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
    }
    response = requests.get(url, headers=headers, timeout=30)
    response.raise_for_status()

    soup = BeautifulSoup(response.text, "html.parser")

    title_tag = soup.find("h1") or soup.find("title")
    title = title_tag.get_text(strip=True) if title_tag else "Unknown"

    for tag in soup.find_all(["nav", "header", "footer", "script", "style"]):
        tag.decompose()

    main = soup.find("main") or soup.find("article") or soup.body
    if main is None:
        return {
            "title": title, "url": url, "full_text": "",
            "sections": [], "candidate_indicators": [],
        }

    sections = []
    current_section = {"heading": "Introduction", "content": []}

    for element in main.descendants:
        if element.name in ("h1", "h2", "h3", "h4"):
            if current_section["content"]:
                current_section["content"] = "\n".join(current_section["content"])
                sections.append(current_section)
            current_section = {"heading": element.get_text(strip=True), "content": []}
        elif element.name in ("p", "li"):
            text = element.get_text(strip=True)
            if text and len(text) > 5:
                current_section["content"].append(text)

    if current_section["content"]:
        current_section["content"] = "\n".join(current_section["content"])
        sections.append(current_section)

    full_text = main.get_text(separator="\n", strip=True)
    full_text = re.sub(r"\n{3,}", "\n\n", full_text)

    candidate_indicators = extract_candidate_indicators(main, sections)

    return {
        "title": title,
        "url": url,
        "full_text": full_text,
        "sections": sections,
        "candidate_indicators": candidate_indicators,
    }


def extract_candidate_indicators(main_element, sections: list[dict]) -> list[dict]:
    """Deterministically extract all candidate indicator texts from the HTML."""
    candidates = []
    seen_texts = set()

    for li in main_element.find_all("li"):
        text = li.get_text(strip=True)
        if _is_indicator_candidate(text) and text not in seen_texts:
            seen_texts.add(text)
            section = _find_parent_section(li, sections)
            candidates.append({
                "text": text,
                "source_element": "li",
                "parent_section": section,
            })

    for p in main_element.find_all("p"):
        text = p.get_text(strip=True)
        if _is_indicator_candidate(text) and text not in seen_texts:
            if _has_behavioral_language(text):
                seen_texts.add(text)
                section = _find_parent_section(p, sections)
                candidates.append({
                    "text": text,
                    "source_element": "p",
                    "parent_section": section,
                })

    return candidates


def _is_indicator_candidate(text: str) -> bool:
    """Check if a text string could be a behavioral indicator."""
    if len(text) < 30:
        return False
    if len(text) > 1000:
        return False

    skip_patterns = [
        r"^(return to|skip to|table of contents)",
        r"^(copyright|date modified|report a problem)",
        r"^(page \d|section \d)",
        r"^https?://",
        r"^(contact|telephone|email|fax)",
        r"^footnote",
    ]
    text_lower = text.lower()
    for pattern in skip_patterns:
        if re.match(pattern, text_lower):
            return False

    if re.match(r"^(fintrac|fatf|austrac|department of|financial action|national crime)", text_lower):
        return False

    return True


def _has_behavioral_language(text: str) -> bool:
    """Check if text contains language typical of behavioral indicators."""
    text_lower = text.lower()
    behavioral_terms = [
        "client", "customer", "account", "transaction", "transfer",
        "deposit", "withdraw", "fund", "payment", "wire",
        "suspicious", "unusual", "inconsistent", "significant",
        "immediately", "quickly", "rapidly", "frequently",
        "structured", "multiple", "large", "cash",
        "unknown", "unclear", "no apparent", "no clear",
        "high-risk", "foreign", "offshore", "international",
        "nominee", "third party", "shell", "front",
        "below", "above", "threshold", "reporting",
    ]
    matches = sum(1 for term in behavioral_terms if term in text_lower)
    return matches >= 2


def _find_parent_section(element, sections: list[dict]) -> str:
    """Find which section heading an element belongs to."""
    for parent in element.parents:
        if parent is None:
            break
        prev = parent.find_previous(["h1", "h2", "h3", "h4"])
        if prev:
            return prev.get_text(strip=True)
    return "Unknown"


def search_document(document: dict, query: str, max_results: int = 5) -> list[dict]:
    """Search within a fetched document for relevant passages."""
    query_lower = query.lower()
    query_terms = query_lower.split()
    results = []

    for section in document.get("sections", []):
        content = section.get("content", "")
        if isinstance(content, list):
            content = "\n".join(content)
        content_lower = content.lower()

        score = sum(1 for term in query_terms if term in content_lower)
        if score > 0:
            results.append({
                "heading": section["heading"],
                "content": content[:1000],
                "relevance_score": score / len(query_terms),
            })

    results.sort(key=lambda x: x["relevance_score"], reverse=True)
    return results[:max_results]
