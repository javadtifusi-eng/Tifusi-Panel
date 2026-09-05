FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY cli ./cli
COPY run.py .
COPY cli_wrapper.sh /usr/local/bin/tifusi-cli
RUN chmod +x /usr/local/bin/tifusi-cli

RUN mkdir -p /app/data

EXPOSE 8000

# run.py plumbs TIFUSI_SSL_CERTFILE/TIFUSI_SSL_KEYFILE into uvicorn when
# they're set and otherwise behaves exactly like the plain uvicorn command
# it replaces — see run.py's own docstring.
CMD ["python", "run.py"]
