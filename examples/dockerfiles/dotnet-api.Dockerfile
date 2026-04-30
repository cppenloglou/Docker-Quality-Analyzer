# .NET 8 Web API with multi-stage build
# Expect: high score
FROM mcr.microsoft.com/dotnet/sdk:8.0-alpine AS build

WORKDIR /src

COPY *.sln .
COPY src/Api/*.csproj src/Api/
COPY src/Domain/*.csproj src/Domain/
COPY src/Infrastructure/*.csproj src/Infrastructure/
COPY tests/Api.Tests/*.csproj tests/Api.Tests/
RUN dotnet restore

COPY src/ src/
COPY tests/ tests/

RUN dotnet test --no-restore --verbosity normal
RUN dotnet publish src/Api/Api.csproj -c Release -o /app/publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:8.0-alpine AS runtime

RUN apk add --no-cache icu-libs curl

WORKDIR /app

COPY --from=build /app/publish .

RUN addgroup -S dotnet && adduser -S dotnet -G dotnet
USER dotnet

ENV ASPNETCORE_URLS=http://+:8080
ENV DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=false
ENV ASPNETCORE_ENVIRONMENT=Production

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=3s --retries=3 \
    CMD curl -f http://localhost:8080/healthz || exit 1

ENTRYPOINT ["dotnet", "Api.dll"]
