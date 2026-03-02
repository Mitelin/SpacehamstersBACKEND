from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = REPO_ROOT / "ZAMEK" / "SCRIPTS"
BACKEND_MAIN = REPO_ROOT / "py_backend" / "main.py"


@dataclass(frozen=True)
class BackendRoute:
    template: str
    methods: set[str]

    @property
    def sample_path(self) -> str:
        # Replace Starlette path params like {wallet:int} with a safe sample segment.
        return re.sub(r"\{[^}]+\}", "1", self.template)


@dataclass(frozen=True)
class ScriptCall:
    file: Path
    line: int
    path_regex: re.Pattern[str]
    path_sample: str  # normalized sample path with numeric placeholders, like /api/corporation/1/jobs/sync
    method: str | None  # GET/POST if inferred
    raw_url_expr: str
    raw_options_expr: str | None


def _read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def _parse_backend_routes(main_py: Path) -> list[BackendRoute]:
    txt = _read_text(main_py)
    routes: list[BackendRoute] = []

    # Example: Route("/api/userInfo", post_user_info, methods=["POST"]),
    route_re = re.compile(
        r"Route\(\s*\"(?P<path>[^\"]+)\"\s*,[^\)]*?methods\s*=\s*\[(?P<methods>[^\]]*)\]",
        re.MULTILINE | re.DOTALL,
    )

    for m in route_re.finditer(txt):
        path = m.group("path")
        methods_raw = m.group("methods")
        methods = {mm.upper() for mm in re.findall(r"\"(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\"", methods_raw)}
        routes.append(BackendRoute(template=path, methods=methods))

    assert routes, "No backend routes parsed from py_backend/main.py"
    return routes


def _iter_fetch_calls(text: str) -> list[tuple[int, str, str | None]]:
    """Return list of (1-based line, url_expr, options_expr)."""
    calls: list[tuple[int, str, str | None]] = []
    needle = "UrlFetchApp.fetch("
    i = 0
    while True:
        start = text.find(needle, i)
        if start < 0:
            break

        # Find opening paren and matching closing paren.
        open_paren = start + len(needle) - 1
        depth = 0
        in_str: str | None = None
        escape = False
        end = None
        for j in range(open_paren, len(text)):
            ch = text[j]
            if in_str is not None:
                if escape:
                    escape = False
                    continue
                if ch == "\\":
                    escape = True
                    continue
                if ch == in_str:
                    in_str = None
                continue
            else:
                if ch in ("'", '"'):
                    in_str = ch
                    continue
                if ch == "(":
                    depth += 1
                    continue
                if ch == ")":
                    depth -= 1
                    if depth == 0:
                        end = j
                        break
                    continue

        if end is None:
            i = start + len(needle)
            continue

        inside = text[open_paren + 1 : end]

        # Split args at top-level commas.
        args: list[str] = []
        buf: list[str] = []
        depth2 = 0
        in_str = None
        escape = False
        for ch in inside:
            if in_str is not None:
                buf.append(ch)
                if escape:
                    escape = False
                    continue
                if ch == "\\":
                    escape = True
                    continue
                if ch == in_str:
                    in_str = None
                continue

            if ch in ("'", '"'):
                in_str = ch
                buf.append(ch)
                continue

            if ch in "([{":
                depth2 += 1
                buf.append(ch)
                continue
            if ch in ")]}":
                depth2 -= 1
                buf.append(ch)
                continue
            if ch == "," and depth2 == 0:
                args.append("".join(buf).strip())
                buf = []
                continue

            buf.append(ch)

        if buf:
            args.append("".join(buf).strip())

        url_expr = args[0] if args else ""
        opts_expr = args[1] if len(args) > 1 else None

        line = text.count("\n", 0, start) + 1
        calls.append((line, url_expr, opts_expr))
        i = end + 1

    return calls


def _infer_method(options_expr: str | None, surrounding_text: str) -> str | None:
    if options_expr is None or options_expr.strip() == "":
        return "GET"

    oe = options_expr.lower()
    if "method" in oe and "post" in oe:
        return "POST"
    if "method" in oe and "get" in oe:
        return "GET"

    # Common naming patterns in these scripts.
    if "options_post" in oe or "authorized_options_post" in oe:
        return "POST"
    if "options_get" in oe or "authorized_options_get" in oe:
        return "GET"

    # Some scripts define `options` nearby.
    window = surrounding_text.lower()
    if re.search(r"['\"]method['\"]\s*:\s*['\"]post['\"]", window):
        return "POST"
    if re.search(r"['\"]method['\"]\s*:\s*['\"]get['\"]", window):
        return "GET"

    return None


def _split_top_level_plus(expr: str) -> list[str]:
    parts: list[str] = []
    buf: list[str] = []
    in_str: str | None = None
    escape = False
    depth = 0

    for ch in expr:
        if in_str is not None:
            buf.append(ch)
            if escape:
                escape = False
                continue
            if ch == "\\":
                escape = True
                continue
            if ch == in_str:
                in_str = None
            continue

        if ch in ("'", '"'):
            in_str = ch
            buf.append(ch)
            continue

        if ch in "([{":
            depth += 1
            buf.append(ch)
            continue
        if ch in ")]}":
            depth -= 1
            buf.append(ch)
            continue

        if ch == "+" and depth == 0:
            part = "".join(buf).strip()
            if part:
                parts.append(part)
            buf = []
            continue

        buf.append(ch)

    tail = "".join(buf).strip()
    if tail:
        parts.append(tail)
    return parts


def _path_to_regex(path: str) -> re.Pattern[str]:
    # Convert a sample path into a regex that tolerates numeric constants.
    out: list[str] = ["^"]
    i = 0
    while i < len(path):
        if path[i].isdigit():
            j = i
            while j < len(path) and path[j].isdigit():
                j += 1
            out.append(r"\d+")
            i = j
            continue
        out.append(re.escape(path[i]))
        i += 1
    out.append("$")
    return re.compile("".join(out))


def _path_to_sample(path: str) -> str:
    """Normalize a path by replacing numeric runs with '1'."""
    out: list[str] = []
    i = 0
    while i < len(path):
        if path[i].isdigit():
            j = i
            while j < len(path) and path[j].isdigit():
                j += 1
            out.append("1")
            i = j
            continue
        out.append(path[i])
        i += 1
    return "".join(out)


def _extract_backend_path_sample(url_expr: str, *, base_var: str = "aubiApi") -> str | None:
    """Best-effort extraction of a normalized /api/... sample path from a UrlFetchApp.fetch() URL expression."""
    expr = url_expr.strip()

    str_lit = re.fullmatch(r"\s*(['\"])(?P<s>.*)\1\s*", expr)
    if str_lit:
        s = str_lit.group("s")
        api_idx = s.find("/api/")
        if api_idx >= 0:
            return _path_to_sample(s[api_idx:])
        if s.startswith("/api/"):
            return _path_to_sample(s)
        return None

    if base_var in expr:
        terms = _split_top_level_plus(expr)
        if not terms:
            return None

        built: list[str] = []
        for t in terms:
            t = t.strip()
            if not t:
                continue
            if t == base_var:
                continue

            lit = re.fullmatch(r"\s*(['\"])(?P<s>.*)\1\s*", t)
            if lit:
                built.append(lit.group("s"))
                continue

            # Any non-literal term becomes a placeholder segment.
            built.append("1")

        combined = "".join(built)

        # Typical pattern in these scripts is: aubiApi (which ends with /api) + '/endpoint/...'
        # After stripping the base var, `combined` is often just '/endpoint/...'.
        api_idx = combined.find("/api/")
        if api_idx >= 0:
            combined = combined[api_idx:]
        else:
            # If we got a leading path segment, assume it's under the /api prefix.
            if combined.startswith("/"):
                combined = "/api" + combined
            elif combined.startswith("api/"):
                combined = "/" + combined

        if not combined.startswith("/api/") and combined.startswith("/api"):
            combined = combined.replace("/api//", "/api/")
        if not combined.startswith("/api/"):
            return None
        return _path_to_sample(combined)

    return None


def _extract_identifier(s: str) -> str | None:
    s = s.strip()
    if re.fullmatch(r"[A-Za-z_$][A-Za-z0-9_$]*", s):
        return s
    return None


def _find_matching_brace(text: str, start_idx: int) -> int | None:
    """Return index of matching '}' for '{' at start_idx."""
    if start_idx < 0 or start_idx >= len(text) or text[start_idx] != "{":
        return None
    depth = 0
    in_str: str | None = None
    escape = False
    for i in range(start_idx, len(text)):
        ch = text[i]
        if in_str is not None:
            if escape:
                escape = False
                continue
            if ch == "\\":
                escape = True
                continue
            if ch == in_str:
                in_str = None
            continue

        if ch in ("'", '"'):
            in_str = ch
            continue
        if ch == "{":
            depth += 1
            continue
        if ch == "}":
            depth -= 1
            if depth == 0:
                return i
            continue
    return None


def _extract_object_literal_after(text: str, idx: int) -> str | None:
    """Extract an object literal starting at the first '{' at or after idx."""
    brace = text.find("{", idx)
    if brace < 0:
        return None
    end = _find_matching_brace(text, brace)
    if end is None:
        return None
    return text[brace : end + 1]


def _resolve_options_evidence(script_text: str, options_expr: str | None, *, call_line_1based: int | None = None) -> str:
    """Return a combined text blob that should include auth/contentType hints for options_expr.

    This is intentionally heuristic (no full JS parser).
    """
    if not options_expr:
        return ""

    expr = options_expr.strip()
    out: list[str] = [expr]

    # Inline object literal.
    if expr.startswith("{"):
        end = _find_matching_brace(expr, 0)
        if end is not None:
            return expr[: end + 1]
        return expr

    # Function call: authorized_options_get()
    func_m = re.fullmatch(r"(?P<name>[A-Za-z_$][A-Za-z0-9_$]*)\s*\(\s*\)", expr)
    if func_m:
        fname = func_m.group("name")
        # Capture body for: function fname(...) { ... } or var fname = function(...) { ... }
        func_def = re.search(
            rf"(?:function\s+{re.escape(fname)}\s*\(|(?:var|let|const)\s+{re.escape(fname)}\s*=\s*function\s*\()",
            script_text,
        )
        if func_def:
            body = _extract_object_literal_after(script_text, func_def.start())  # will grab '{...}' of function body
            if body:
                out.append(body)
        return "\n".join(out)

    # Identifier: options_get, options, options_post
    ident = _extract_identifier(expr)
    if not ident:
        return "\n".join(out)

    # Prefer resolving evidence near the callsite (same function/block) to avoid
    # picking up unrelated `options` variables in other parts of the file.
    scope_text = script_text
    if call_line_1based is not None:
        scope_text = _get_line_window(script_text, line_1based=call_line_1based, before=240, after=0)

    # If `ident` is assigned from another identifier or helper function (common pattern:
    #   var options = authorized_options_post();
    #   var options = options_post;
    # ) then include evidence for the RHS as well.
    assign_rhs: str | None = None
    assign_iter = list(
        re.finditer(
            rf"(?:var|let|const)\s+{re.escape(ident)}\s*=\s*(?P<rhs>[^;\n]+)",
            scope_text,
        )
    )
    if assign_iter:
        assign_rhs = assign_iter[-1].group("rhs").strip()
        out.append(assign_rhs)
        # Follow one level of indirection.
        out.append(_resolve_options_evidence(script_text, assign_rhs, call_line_1based=call_line_1based))

    # If helper functions reference base option objects (e.g. authorized_options_post() uses options_post),
    # include evidence for those as well so contentType is discoverable.
    joined = "\n".join(out)
    for base_ident in ("options_post", "options_get"):
        if ident != base_ident and re.search(rf"\b{base_ident}\b", joined):
            out.append(_resolve_options_evidence(script_text, base_ident, call_line_1based=call_line_1based))

    # Try to find its assignment.
    # e.g. const options_post = { ... }
    assign = re.search(rf"(?:var|let|const)\s+{re.escape(ident)}\s*=", script_text)
    if assign:
        obj = _extract_object_literal_after(script_text, assign.end())
        if obj:
            out.append(obj)

    # Also include any line that assigns headers.authorization / Authorization on that ident.
    for m in re.finditer(rf"\b{re.escape(ident)}\s*\.\s*headers\s*\.\s*(?:authorization|Authorization)\s*=", script_text):
        start = max(0, script_text.rfind("\n", 0, m.start()))
        end = script_text.find("\n", m.start())
        if end < 0:
            end = len(script_text)
        out.append(script_text[start:end])

    return "\n".join(out)


def _looks_like_json_content_type(evidence: str) -> bool:
    e = evidence.lower()
    return ("contenttype" in e and "application/json" in e) or ("content-type" in e and "application/json" in e)


def _looks_like_bearer_auth(evidence: str) -> bool:
    e = evidence.lower()
    return ("authorization" in e) and ("bearer" in e)


def _call_has_payload_nearby(script_path: Path, call_line_1based: int, options_expr: str | None) -> bool:
    """Heuristic: if the code assigns <opts>.payload = ... near the fetch call, treat as payload present."""
    if not options_expr:
        return False
    ident = _extract_identifier(options_expr)
    if not ident:
        return False

    lines = script_path.read_text(encoding="utf-8", errors="replace").splitlines()
    idx = max(0, call_line_1based - 1)
    start = max(0, idx - 25)
    window = "\n".join(lines[start : idx + 1])
    return re.search(rf"\b{re.escape(ident)}\s*\.\s*payload\s*=", window) is not None


def _get_line_window(script_text: str, *, line_1based: int, before: int = 120, after: int = 20) -> str:
    lines = script_text.splitlines()
    i = max(0, line_1based - 1)
    start = max(0, i - before)
    end = min(len(lines), i + after)
    return "\n".join(lines[start:end])


def _extract_payload_expr(script_text: str, call: ScriptCall) -> str | None:
    """Try to extract the payload expression used for a fetch call.

    Supports:
    - inline options object: { payload: JSON.stringify(req), ... }
    - nearby assignment: options.payload = JSON.stringify(req)
    """
    if not call.raw_options_expr:
        return None

    opts = call.raw_options_expr.strip()

    # Inline object literal in fetch(..., { ... }).
    if opts.startswith("{"):
        m = re.search(
            r"(?:\bpayload\b|['\"]payload['\"])\s*:\s*(?P<rhs>[^,}]+)",
            opts,
            flags=re.IGNORECASE,
        )
        if m:
            return m.group("rhs").strip()
        return None

    ident = _extract_identifier(opts)
    if not ident:
        # e.g. authorized_options_get() - no payload expected
        return None

    # Search nearby for: <ident>.payload = ...
    # Prefer the closest assignment before the call (there can be multiple `options.payload = ...` in the file).
    win = _get_line_window(script_text, line_1based=call.line, before=120, after=5)
    matches = list(re.finditer(rf"\b{re.escape(ident)}\s*\.\s*payload\s*=\s*(?P<rhs>[^;\n]+)", win))
    if matches:
        return matches[-1].group("rhs").strip()

    # Or: var <ident> = { ... payload: ... }
    win2 = _get_line_window(script_text, line_1based=call.line, before=120, after=0)
    assign = re.search(rf"(?:var|let|const)\s+{re.escape(ident)}\s*=\s*\{{", win2)
    if assign:
        obj = _extract_object_literal_after(win2, assign.end() - 1)
        if obj:
            m2 = re.search(
                r"(?:\bpayload\b|['\"]payload['\"])\s*:\s*(?P<rhs>[^,}]+)",
                obj,
                flags=re.IGNORECASE,
            )
            if m2:
                return m2.group("rhs").strip()
    return None


def _unwrap_json_stringify(expr: str) -> str | None:
    m = re.fullmatch(r"JSON\.stringify\(\s*(?P<inner>.*)\s*\)", expr.strip())
    if m:
        return m.group("inner").strip()
    return None


def _extract_object_literal_keys(obj_literal: str) -> set[str]:
    """Extract keys from a JS object literal string (heuristic)."""
    keys = set()
    for m in re.finditer(r"(?:^|[,{])\s*(?:['\"](?P<qk>[^'\"]+)['\"]|(?P<k>[A-Za-z_$][A-Za-z0-9_$]*))\s*:", obj_literal):
        key = m.group("qk") or m.group("k")
        if key:
            keys.add(key)
    return keys


def _extract_req_keys_from_window(window_text: str, req_ident: str) -> set[str]:
    keys: set[str] = set()

    # var req = { a: 1, "b": 2 }
    inits = list(re.finditer(rf"(?:var|let|const)\s+{re.escape(req_ident)}\s*=\s*\{{", window_text))
    if inits:
        init = inits[-1]  # nearest definition in the window
        obj = _extract_object_literal_after(window_text, init.end() - 1)
        if obj:
            keys |= _extract_object_literal_keys(obj)

    # req.foo = ...
    for m in re.finditer(rf"\b{re.escape(req_ident)}\s*\.\s*(?P<k>[A-Za-z_$][A-Za-z0-9_$]*)\s*=", window_text):
        keys.add(m.group("k"))

    # req['foo'] = ... / req["foo"] = ...
    for m in re.finditer(
        rf"\b{re.escape(req_ident)}\s*\[\s*(['\"])(?P<k>[^'\"]+)\1\s*\]\s*=",
        window_text,
    ):
        keys.add(m.group("k"))

    return keys


def _extract_payload_keys_for_call(call: ScriptCall) -> set[str]:
    script_text = _read_text(call.file)
    payload_expr = _extract_payload_expr(script_text, call)
    if not payload_expr:
        return set()

    inner = _unwrap_json_stringify(payload_expr) or payload_expr

    # Object literal payload.
    if inner.strip().startswith("{"):
        end = _find_matching_brace(inner, 0)
        if end is not None:
            return _extract_object_literal_keys(inner[: end + 1])

    ident = _extract_identifier(inner)
    if ident:
        window_text = _get_line_window(script_text, line_1based=call.line, before=220, after=5)
        return _extract_req_keys_from_window(window_text, ident)

    return set()


def _assert_required_keys(call: ScriptCall, keys: set[str], required: set[str]) -> str | None:
    missing = sorted(k for k in required if k not in keys)
    if missing:
        return (
            f"{call.file.relative_to(REPO_ROOT)}:{call.line}: {call.path_sample} method={call.method} "
            f"missing keys {missing} (found {sorted(keys)})"
        )
    return None


def _extract_backend_path_regex(url_expr: str, *, base_var: str = "aubiApi") -> re.Pattern[str] | None:
    expr = url_expr.strip()

    # If it's a quoted full URL or quoted path, extract /api/... from it.
    str_lit = re.fullmatch(r"\s*(['\"])(?P<s>.*)\1\s*", expr)
    if str_lit:
        s = str_lit.group("s")
        api_idx = s.find("/api/")
        if api_idx >= 0:
            return _path_to_regex(s[api_idx:])
        if s.startswith("/api/"):
            return _path_to_regex(s)
        return None

    # Expressions like: aubiApi + '/corporation/' + corporationId.toString() + '/jobs/report/' + year + '/' + month
    if base_var in expr:
        terms = _split_top_level_plus(expr)
        if not terms:
            return None

        built: list[str] = []
        for t in terms:
            t = t.strip()

            # Base var: normalize to just '/api'
            if re.fullmatch(rf"{re.escape(base_var)}\b.*", t):
                built.append("/api")
                continue

            lit = re.fullmatch(r"\s*(['\"])(?P<s>.*)\1\s*", t)
            if lit:
                built.append(lit.group("s"))
                continue

            # Any non-literal term becomes a placeholder segment.
            built.append("1")

        combined = "".join(built)

        # If combined still contains a full URL, trim to the /api/... part.
        api_idx = combined.find("/api/")
        if api_idx >= 0:
            combined = combined[api_idx:]
        if not combined.startswith("/api/") and combined.startswith("/api"):
            # '/api' + '/foo' => '/api/foo'
            combined = combined.replace("/api//", "/api/")

        if not combined.startswith("/api/"):
            return None

        return _path_to_regex(combined)

    return None


def _collect_script_calls() -> list[ScriptCall]:
    calls: list[ScriptCall] = []
    for path in sorted(SCRIPTS_DIR.glob("*")):
        if path.suffix.lower() not in (".gs", ".html"):
            continue
        try:
            if path.stat().st_size == 0:
                # Common when scripts were pasted into the editor but not saved to disk,
                # or when the folder is present but content isn't checked out.
                continue
        except OSError:
            continue
        txt = _read_text(path)
        fetches = _iter_fetch_calls(txt)

        for line, url_expr, opts_expr in fetches:
            method = _infer_method(opts_expr, txt)

            path_re = _extract_backend_path_regex(url_expr)
            if path_re is None:
                continue

            path_sample = _extract_backend_path_sample(url_expr)
            if path_sample is None:
                # Should not happen if regex extraction worked, but keep it robust.
                continue

            calls.append(
                ScriptCall(
                    file=path,
                    line=line,
                    path_regex=path_re,
                    path_sample=path_sample,
                    method=method,
                    raw_url_expr=url_expr,
                    raw_options_expr=opts_expr,
                )
            )

    return calls


def test_google_scripts_backend_api_calls_match_backend_routes() -> None:
    assert SCRIPTS_DIR.exists(), "Expected ZAMEK/SCRIPTS to exist"

    script_files = [p for p in sorted(SCRIPTS_DIR.glob("*")) if p.suffix.lower() in (".gs", ".html")]
    if not script_files:
        pytest.skip("No Google Apps Script files found in ZAMEK/SCRIPTS")

    nonempty = []
    empty = []
    for p in script_files:
        try:
            (nonempty if p.stat().st_size > 0 else empty).append(p)
        except OSError:
            empty.append(p)

    if not nonempty:
        msg = [
            "Google Apps Script contract test cannot run because all files in ZAMEK/SCRIPTS are empty on disk (0 bytes).",
            "This often happens when scripts were pasted into the editor but not saved.",
            "Action: in VS Code use File -> Save All, then re-run pytest.",
        ]
        if empty:
            msg.append("Empty files: " + ", ".join(str(p.name) for p in empty[:20]) + (" ..." if len(empty) > 20 else ""))
        raise AssertionError("\n".join(msg))

    routes = _parse_backend_routes(BACKEND_MAIN)
    calls = _collect_script_calls()

    if not calls:
        raise AssertionError(
            "No backend API calls found in ZAMEK/SCRIPTS on disk (UrlFetchApp.fetch -> /api/...).\n"
            "If these scripts should call the backend, either:\n"
            "- the files are still not saved to disk (check they are non-empty), or\n"
            "- the scripts build URLs in an unexpected way and the parser needs to be updated."
        )

    failures: list[str] = []
    for call in calls:
        matched = []
        for r in routes:
            if call.path_regex.match(r.sample_path):
                if call.method is None or call.method in r.methods:
                    matched.append(r)

        if not matched:
            failures.append(
                f"{call.file.relative_to(REPO_ROOT)}:{call.line}: no matching backend route for method={call.method} url={call.raw_url_expr!r} opts={call.raw_options_expr!r}"
            )

    assert not failures, "\n".join(failures)


def test_google_scripts_corporation_calls_have_bearer_auth() -> None:
    """All /api/corporation/... calls should carry Authorization: Bearer ..."""
    calls = _collect_script_calls()
    assert calls, "No backend /api calls collected from scripts"

    failures: list[str] = []
    for call in calls:
        if not call.path_sample.startswith("/api/corporation/"):
            continue

        txt = _read_text(call.file)
        evidence = _resolve_options_evidence(txt, call.raw_options_expr, call_line_1based=call.line)
        if not _looks_like_bearer_auth(evidence):
            failures.append(
                f"{call.file.relative_to(REPO_ROOT)}:{call.line}: missing Bearer auth for {call.path_sample} opts={call.raw_options_expr!r}"
            )

    assert not failures, "\n".join(failures)


def test_google_scripts_post_calls_send_json_payload() -> None:
    """POST/PUT/PATCH calls to our backend must send JSON payload + contentType application/json."""
    calls = _collect_script_calls()
    assert calls, "No backend /api calls collected from scripts"

    failures: list[str] = []
    for call in calls:
        if call.method not in {"POST", "PUT", "PATCH"}:
            continue

        # Only enforce for our backend.
        if not call.path_sample.startswith("/api/"):
            continue

        txt = _read_text(call.file)
        evidence = _resolve_options_evidence(txt, call.raw_options_expr, call_line_1based=call.line)

        has_json = _looks_like_json_content_type(evidence)
        has_payload = ("payload" in evidence.lower()) or _call_has_payload_nearby(call.file, call.line, call.raw_options_expr)

        if not has_json or not has_payload:
            failures.append(
                f"{call.file.relative_to(REPO_ROOT)}:{call.line}: {call.path_sample} method={call.method} missing "
                f"{'contentType=application/json' if not has_json else ''}{' and ' if (not has_json and not has_payload) else ''}{'payload' if not has_payload else ''}"
            )

    assert not failures, "\n".join(failures)


def test_google_scripts_payload_shapes_minimal() -> None:
    """Minimal payload shape contracts for endpoints that parse specific keys.

    This is intentionally conservative: it checks only keys that the backend handler reads.
    """
    calls = _collect_script_calls()
    assert calls, "No backend /api calls collected from scripts"

    failures: list[str] = []
    for call in calls:
        if call.method not in {"POST", "PUT", "PATCH"}:
            continue

        keys = _extract_payload_keys_for_call(call)

        # /api/ore/material expects body.get("typeName")
        if call.path_sample == "/api/ore/material":
            msg = _assert_required_keys(call, keys, {"typeName"})
            if msg:
                failures.append(msg)
            continue

        # /api/blueprints/calculate expects body.get("types")
        if call.path_sample == "/api/blueprints/calculate":
            msg = _assert_required_keys(call, keys, {"types"})
            if msg:
                failures.append(msg)
            else:
                # Heuristic: ensure the script code mentions typeId+amount near the call (types elements shape).
                script_text = _read_text(call.file)
                win = _get_line_window(script_text, line_1based=call.line, before=260, after=10)
                if "typeId" not in win or "amount" not in win:
                    failures.append(
                        f"{call.file.relative_to(REPO_ROOT)}:{call.line}: {call.path_sample} "
                        f"could not find 'typeId' and 'amount' near payload construction"
                    )
            continue

        # /api/userInfo backend expects access_token (but scripts pass through SSO response object)
        # We validate this via a separate flow test below.

        # /api/corporation/.../assets POST expects locationID/locationType/locationFlag
        if re.fullmatch(r"/api/corporation/\d+/assets", call.path_sample):
            msg = _assert_required_keys(call, keys, {"locationID", "locationType", "locationFlag"})
            if msg:
                failures.append(msg)
            continue

        # /api/corporation/.../jobs/velocity POST expects categories
        if re.fullmatch(r"/api/corporation/\d+/jobs/velocity", call.path_sample):
            msg = _assert_required_keys(call, keys, {"categories"})
            if msg:
                failures.append(msg)
            continue

        # /api/corporation/.../wallets/.../journal/report POST expects year/month/types
        if re.fullmatch(r"/api/corporation/\d+/wallets/\d+/journal/report", call.path_sample):
            msg = _assert_required_keys(call, keys, {"year", "month", "types"})
            if msg:
                failures.append(msg)
            continue

    assert not failures, "\n".join(failures)


def test_google_scripts_userinfo_flow_has_access_token() -> None:
    """Backend requires access_token in /api/userInfo body; ensure scripts pass an object that has it."""
    failures: list[str] = []
    for path in sorted(SCRIPTS_DIR.glob("*.gs")):
        txt = _read_text(path)
        for m in re.finditer(r"\bAubi\s*\.\s*syncUser\s*\(\s*(?P<arg>[A-Za-z_$][A-Za-z0-9_$]*)\s*\)", txt):
            arg = m.group("arg")
            # Look around the call site for evidence the object has access_token.
            line = txt[: m.start()].count("\n") + 1
            win = _get_line_window(txt, line_1based=line, before=80, after=40)
            if re.search(rf"\b{re.escape(arg)}\s*\.\s*access_token\b", win) or re.search(
                rf"\b{re.escape(arg)}\s*\[\s*['\"]access_token['\"]\s*\]",
                win,
            ):
                continue
            failures.append(
                f"{path.relative_to(REPO_ROOT)}:{line}: Aubi.syncUser({arg}) without nearby evidence of {arg}.access_token"
            )

    assert not failures, "\n".join(failures)
