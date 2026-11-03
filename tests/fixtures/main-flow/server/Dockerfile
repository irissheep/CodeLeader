FROM example/python
COPY server/app app
EXPOSE 9000
CMD ["python", "-m", "uvicorn", "app.main:app", "--port", "9000"]
