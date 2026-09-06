FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt ./
# 使用国内 PyPI 镜像，避免容器内构建时下载缓慢。
RUN pip install --no-cache-dir -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple

COPY . .

EXPOSE 8000

# 容器内必须绑定 0.0.0.0 供 compose 网络访问；reload 关闭。
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
