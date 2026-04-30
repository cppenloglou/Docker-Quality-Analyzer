from flask import Flask

app = Flask(__name__)


@app.get("/")
def index():
    return {"service": "python-webapp", "ok": True}


@app.get("/health")
def health():
    return {"status": "ok"}


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
