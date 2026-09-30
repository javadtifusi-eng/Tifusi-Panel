# The Windows REALITY probe (reality_probe/, a Go program) is built with the
# panel so every panel hands out the copy that matches its field test, with
# no separate download site to keep in step. Zipped in its own stage so the
# 30 MB exe never lands in a layer of the final image.
FROM golang:1.26 AS probe
WORKDIR /src
COPY reality_probe/go.mod reality_probe/go.sum ./
RUN go mod download
COPY reality_probe/ ./
RUN CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "-s -w" -o /out/TifusiRealityProbe.exe .

FROM python:3.12-slim AS probezip
COPY --from=probe /out/TifusiRealityProbe.exe /out/
RUN python -c "import zipfile; z = zipfile.ZipFile('/out/TifusiRealityProbe.zip', 'w', zipfile.ZIP_DEFLATED, compresslevel=9); z.write('/out/TifusiRealityProbe.exe', 'TifusiRealityProbe.exe'); z.close()"

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
COPY --from=probezip /out/TifusiRealityProbe.zip ./reality_probe/
COPY cli_wrapper.sh /usr/local/bin/tifusi-cli
RUN chmod +x /usr/local/bin/tifusi-cli

RUN mkdir -p /app/data

EXPOSE 8000

# run.py plumbs TIFUSI_SSL_CERTFILE/TIFUSI_SSL_KEYFILE into uvicorn when
# they're set and otherwise behaves exactly like the plain uvicorn command
# it replaces — see run.py's own docstring.
CMD ["python", "run.py"]
