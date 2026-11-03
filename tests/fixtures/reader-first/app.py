from fastapi import FastAPI

app = FastAPI()


@app.get('/ping')
def ping():
    """Return a readiness flag."""
    return {'ready': True}


@app.post('/echo')
def echo(text: str):
    """Return the supplied text without persistence."""
    return {'text': text}
