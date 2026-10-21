ARG BASE_IMAGE=python:3.11-slim
FROM ${BASE_IMAGE}
WORKDIR /fixture
COPY worker.py /fixture/worker.py
ENV PYTHONUNBUFFERED=1
EXPOSE 8081
CMD ["python", "/fixture/worker.py"]
