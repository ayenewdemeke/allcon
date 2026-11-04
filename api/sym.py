"""
SymPy worker for allcon's Calcs: symbolic evaluation (Mathcad's →).

allcon's Next.js server calls this function (never browsers directly). A request carries
expressions as trees of whitelisted operations, built by allcon from the worksheet's math; they
are put together with SymPy's constructors and never evaluated as code. Names arrive as opaque
ids with the LaTeX to show them by. Each answer is LaTeX, or an error to show.

Deployed as a Vercel Python function at /api/sym. Locally: python api/sym.py (port 5329).
"""

import hashlib
import hmac
import json
import os
import re
import signal
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

import sympy as sp

MAX_NODES = 4000
MAX_DEPTH = 200
TIME_LIMIT = 8  # seconds per expression
NUMBER = re.compile(r"^-?\d{1,30}(\.\d{1,30})?([eE][-+]?\d{1,3})?$")

FUNCTIONS = {
    "sin": sp.sin, "cos": sp.cos, "tan": sp.tan, "cot": sp.cot, "sec": sp.sec, "csc": sp.csc,
    "asin": sp.asin, "acos": sp.acos, "atan": sp.atan, "sinh": sp.sinh, "cosh": sp.cosh, "tanh": sp.tanh,
    "exp": sp.exp, "ln": sp.log, "log": lambda x: sp.log(x, 10), "sqrt": sp.sqrt, "abs": sp.Abs,
    "floor": sp.floor, "ceil": sp.ceiling, "max": sp.Max, "min": sp.Min,
}
RELATIONS = {"==": sp.Eq, "<": sp.Lt, ">": sp.Gt, "<=": sp.Le, ">=": sp.Ge, "!=": sp.Ne}
CONSTANTS = {"pi": sp.pi, "e": sp.E, "oo": sp.oo, "i": sp.I}


def expected_token():
    secret = os.environ.get("BETTER_AUTH_SECRET", "")
    return hmac.new(secret.encode(), b"conkit-sym-worker", hashlib.sha256).hexdigest() if secret else None


class Unsupported(ValueError):
    pass


class TimeUp(Exception):
    pass


def build(tree, symbols, budget):
    """A SymPy expression from a tree: [op, ...args]."""

    def go(t, depth):
        budget[0] -= 1
        if budget[0] < 0 or depth > MAX_DEPTH:
            raise Unsupported("This is too big to work out symbolically")
        if not isinstance(t, list) or not t or not isinstance(t[0], str):
            raise Unsupported("Can't read this expression")
        op, args = t[0], t[1:]
        if op == "num":
            text = str(args[0])
            if not NUMBER.match(text):
                raise Unsupported("Can't read a number")
            return sp.Integer(text) if re.match(r"^-?\d+$", text) else sp.Float(text, 15)
        if op == "sym":
            name = str(args[0])
            if not re.match(r"^[a-z]\w{0,20}$", name):
                raise Unsupported("Can't read a name")
            return symbols.setdefault(name, sp.Symbol(name))
        if op == "const":
            if args[0] not in CONSTANTS:
                raise Unsupported(f"Unknown constant {args[0]}")
            return CONSTANTS[args[0]]
        sub = lambda x: go(x, depth + 1)  # noqa: E731
        if op == "add":
            return sub(args[0]) + sub(args[1])
        if op == "sub":
            return sub(args[0]) - sub(args[1])
        if op == "mul":
            a, b = sub(args[0]), sub(args[1])
            return a * b
        if op == "div":
            return sub(args[0]) / sub(args[1])
        if op == "pow":
            base, power = sub(args[0]), sub(args[1])
            if power.is_Integer and abs(int(power)) > 1000:
                raise Unsupported("That power is too large to work out")
            return base**power
        if op == "neg":
            return -sub(args[0])
        if op == "rel":
            if args[0] not in RELATIONS:
                raise Unsupported(f"Unknown relation {args[0]}")
            return RELATIONS[args[0]](sub(args[1]), sub(args[2]))
        if op == "and":
            return sp.And(sub(args[0]), sub(args[1]))
        if op == "or":
            return sp.Or(sub(args[0]), sub(args[1]))
        if op == "fn":
            name = args[0]
            if name not in FUNCTIONS:
                raise Unsupported(f"{name} can't be worked out symbolically")
            return FUNCTIONS[name](*[sub(a) for a in args[1:]])
        if op == "root":
            return sp.root(sub(args[0]), sub(args[1]))
        if op == "matrix":
            return sp.Matrix([[sub(c) for c in row] for row in args[0]])
        if op == "transpose":
            return sp.transpose(sub(args[0]))
        if op == "det":
            m = sub(args[0])
            return m.det() if isinstance(m, sp.MatrixBase) else sp.Abs(m)
        if op in ("sum", "prod"):
            v, lo, hi, body = sub(args[0]), sub(args[1]), sub(args[2]), sub(args[3])
            return (sp.summation if op == "sum" else sp.product)(body, (v, lo, hi))
        if op == "integral":
            v, body = sub(args[0]), sub(args[3])
            if args[1] is None or args[2] is None:
                return sp.integrate(body, v)
            return sp.integrate(body, (v, sub(args[1]), sub(args[2])))
        if op == "diff":
            return sp.diff(sub(args[2]), sub(args[0]), int(args[1]))
        if op == "cases":
            pieces = [(sub(value), True if cond is None else sub(cond)) for value, cond in args[0]]
            if pieces[-1][1] is not True:
                pieces.append((sp.nan, True))
            return sp.Piecewise(*pieces)
        if op == "kw":
            return keyword(args[0], [sub(a) for a in args[1:]])
        raise Unsupported(f"{op} can't be worked out symbolically")

    return go(tree, 0)


def keyword(name, args):
    """Mathcad's symbolic keywords, written as functions: simplify(e), solve(eq, x)..."""
    if not args:
        raise Unsupported(f"{name} needs something to work on")
    e = args[0]
    if name == "simplify":
        return sp.simplify(e)
    if name == "expand":
        return sp.expand(e)
    if name == "factor":
        return sp.factor(e)
    if name == "collect":
        return sp.collect(sp.expand(e), args[1]) if len(args) > 1 else sp.collect(sp.expand(e), list(e.free_symbols))
    if name == "partfrac":
        return sp.apart(e, args[1]) if len(args) > 1 else sp.apart(e)
    if name == "solve":
        if len(args) < 2:
            free = sorted(e.free_symbols, key=str)
            if len(free) != 1:
                raise Unsupported("Say which name to solve for: solve(equation, x)")
            args = [e, free[0]]
        solutions = sp.solve(e, args[1])
        if isinstance(solutions, dict):
            solutions = [solutions.get(args[1], args[1])]
        if not solutions:
            raise Unsupported("No solution found")
        return solutions[0] if len(solutions) == 1 else sp.Matrix(solutions)
    if name == "series":
        v = args[1] if len(args) > 1 else sorted(e.free_symbols, key=str)[0]
        at = args[2] if len(args) > 2 else 0
        order = int(args[3]) if len(args) > 3 else 6
        return sp.series(e, v, at, order).removeO()
    if name == "limit":
        if len(args) < 3:
            raise Unsupported("limit takes an expression, a name and where it goes: limit(f, x, 0)")
        return sp.limit(e, args[1], args[2])
    if name == "subs":
        pairs = []
        for rel in args[1:]:
            if not isinstance(rel, sp.Equality):
                raise Unsupported("subs takes equations: subs(e, x = 2, y = b)")
            pairs.append((rel.lhs, rel.rhs))
        return e.subs(pairs)
    if name == "float":
        digits = int(args[1]) if len(args) > 1 else 6
        return sp.N(e, max(1, min(digits, 30)))
    raise Unsupported(f"Unknown keyword {name}")


def work_out(request):
    names = {k: str(v) for k, v in (request.get("names") or {}).items()}
    symbols = {}
    budget = [MAX_NODES]

    def on_alarm(*_):
        raise TimeUp()

    timed = True
    try:
        previous = signal.signal(signal.SIGALRM, on_alarm)
        signal.alarm(TIME_LIMIT)
    except (ValueError, AttributeError):  # not in the main thread: the function's own limit applies
        timed = False
    try:
        result = build(request["tree"], symbols, budget)
        if request["tree"][0] != "kw":  # → alone simplifies, as Mathcad's does; keywords give what they say
            result = sp.simplify(result) if not isinstance(result, (sp.MatrixBase, sp.Piecewise)) else result
        shown = {s: names.get(n, n) for n, s in symbols.items()}
        return {"latex": sp.latex(result, symbol_names=shown, mul_symbol="dot", ln_notation=True)}
    except Unsupported as error:
        return {"error": str(error)}
    except TimeUp:
        return {"error": "This took too long to work out symbolically"}
    except Exception as error:  # SymPy couldn't do it
        return {"error": f"Couldn't work this out symbolically ({type(error).__name__})"}
    finally:
        if timed:
            signal.alarm(0)
            signal.signal(signal.SIGALRM, previous)


def handle(payload):
    requests = payload.get("requests") or []
    if not isinstance(requests, list) or len(requests) > 50:
        raise ValueError("Send up to 50 expressions at a time")
    return {"results": {str(r.get("key")): work_out(r) for r in requests}}


class handler(BaseHTTPRequestHandler):
    def _send(self, status, body):
        data = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        self._send(200, {"ok": True, "sympy": sp.__version__})

    def do_POST(self):
        token = expected_token()
        if not token or not hmac.compare_digest(self.headers.get("x-conkit-worker", ""), token):
            return self._send(401, {"ok": False, "error": "unauthorized"})
        started = time.time()
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length > 2_000_000:
                return self._send(413, {"ok": False, "error": "Too much at once"})
            body = handle(json.loads(self.rfile.read(length) or b"{}"))
            body.update({"ok": True, "ms": round((time.time() - started) * 1000)})
            self._send(200, body)
        except ValueError as error:
            self._send(400, {"ok": False, "error": str(error)})
        except Exception as error:
            self._send(500, {"ok": False, "error": f"{type(error).__name__}: {error}"})

    def log_message(self, *args):  # keep request logs quiet
        pass


if __name__ == "__main__":
    port = int(os.environ.get("SYM_WORKER_PORT", "5329"))
    print(f"allcon SymPy worker on http://127.0.0.1:{port}/api/sym (sympy {sp.__version__})")
    HTTPServer(("127.0.0.1", port), handler).serve_forever()
