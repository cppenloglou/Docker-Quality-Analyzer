.PHONY: run test docker-dev docker-test docker-prod build-images images-up images-smoke clean

run:
	python -m app.main

test:
	pytest -q

docker-dev:
	docker compose up --build

docker-test:
	docker compose --profile test up --build --abort-on-container-exit --exit-code-from tests tests

docker-smoke:
	docker compose --profile test up --build --abort-on-container-exit --exit-code-from smoke smoke

docker-prod:
	docker compose -f docker-compose.prod.yml up --build

build-images:
	docker build -t local/python-mini-task-app:prod -f Dockerfile .
	docker build -t local/python-mini-task-app:smoke -f Dockerfile.smoke .

images-up:
	docker compose -f docker-compose.images.yml up

images-smoke:
	docker compose -f docker-compose.images.yml --profile test up --abort-on-container-exit --exit-code-from smoke smoke

clean:
	docker compose down -v --remove-orphans
	docker compose -f docker-compose.prod.yml down -v --remove-orphans
	docker compose -f docker-compose.images.yml down -v --remove-orphans
