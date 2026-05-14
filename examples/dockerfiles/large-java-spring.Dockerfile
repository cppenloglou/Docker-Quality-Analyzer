# Large real-world Java Spring Boot application
# Expect: medium score due to complexity and some warnings
FROM eclipse-temurin:21-jdk-alpine AS builder

WORKDIR /workspace

COPY gradle/ gradle/
COPY gradlew build.gradle.kts settings.gradle.kts ./
RUN chmod +x gradlew && ./gradlew dependencies --no-daemon

COPY src/ src/
RUN ./gradlew bootJar --no-daemon -x test

FROM eclipse-temurin:21-jre-alpine AS runtime

RUN apk add --no-cache curl dumb-init

RUN addgroup -g 1001 -S appgroup && \
    adduser -u 1001 -S appuser -G appgroup

WORKDIR /app

COPY --from=builder /workspace/build/libs/*.jar app.jar

RUN mkdir -p /app/logs /app/config /app/tmp && \
    chown -R appuser:appgroup /app

ENV JAVA_OPTS="-XX:+UseContainerSupport \
    -XX:MaxRAMPercentage=75.0 \
    -XX:InitialRAMPercentage=50.0 \
    -Djava.security.egd=file:/dev/./urandom \
    -Dspring.profiles.active=prod \
    -Dserver.tomcat.basedir=/app/tmp"

ENV SERVER_PORT=8080
ENV MANAGEMENT_SERVER_PORT=8081
ENV SPRING_DATASOURCE_URL=jdbc:postgresql://db:5432/appdb
ENV SPRING_DATASOURCE_USERNAME=app
ENV SPRING_DATASOURCE_PASSWORD=changeme
ENV SPRING_REDIS_HOST=redis
ENV SPRING_REDIS_PORT=6379
ENV SPRING_KAFKA_BOOTSTRAP_SERVERS=kafka:9092

EXPOSE 8080 8081

USER appuser

HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:8081/actuator/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["sh", "-c", "java $JAVA_OPTS -jar app.jar"]
