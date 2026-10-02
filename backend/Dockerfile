# The REALITY probe (reality_probe/, a Go program) is built with the panel so
# every panel hands out the copy that matches its scan: arm64 Linux for Termux
# on a phone, amd64 Linux, and Windows.
FROM golang:1.26 AS probe
WORKDIR /src
COPY reality_probe/go.mod reality_probe/go.sum ./
RUN go mod download
COPY reality_probe/ ./
RUN CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -trimpath -ldflags "-s -w" -o /out/tifusi-probe-arm64 . \
 && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags "-s -w" -o /out/tifusi-probe-amd64 . \
 && CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "-s -w" -o /out/TifusiProbe.exe .

FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY VERSION .
COPY app ./app
COPY cli ./cli
COPY alembic ./alembic
COPY alembic.ini .
COPY run.py .
COPY --from=probe /out/ ./reality_probe/dist/
COPY cli_wrapper.sh /usr/local/bin/tifusi-cli
RUN chmod +x /usr/local/bin/tifusi-cli

RUN mkdir -p /app/data

EXPOSE 8000

# run.py plumbs TIFUSI_SSL_CERTFILE/TIFUSI_SSL_KEYFILE into uvicorn when
# they're set and otherwise behaves exactly like the plain uvicorn command
# it replaces — see run.py's own docstring.
CMD ["python", "run.py"]
