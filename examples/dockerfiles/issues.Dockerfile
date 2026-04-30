# Expect: many hadolint warnings + security issues (runs as root, latest tag).
FROM ubuntu:latest

RUN apt-get update
RUN apt-get install -y curl wget git python3 python3-pip
RUN pip3 install flask requests

ADD . /app
WORKDIR /app

ENV SECRET_API_KEY=plaintext-secret-key-123

EXPOSE 80 443
CMD python3 app.py
