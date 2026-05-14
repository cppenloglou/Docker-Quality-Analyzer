# PHP Laravel application with nginx + PHP-FPM
# Expect: good score, realistic production setup
FROM php:8.3-fpm-alpine AS base

RUN apk add --no-cache \
    icu-dev libzip-dev libpng-dev libjpeg-turbo-dev freetype-dev \
    oniguruma-dev linux-headers

RUN docker-php-ext-configure gd --with-freetype --with-jpeg && \
    docker-php-ext-install -j$(nproc) \
    pdo_mysql intl zip gd bcmath opcache pcntl

COPY --from=composer:2.7 /usr/bin/composer /usr/bin/composer

WORKDIR /var/www/html

FROM base AS composer-deps

COPY composer.json composer.lock ./
RUN composer install --no-dev --no-scripts --no-autoloader --prefer-dist

FROM base AS npm-build

RUN apk add --no-cache nodejs npm
COPY package.json package-lock.json ./
RUN npm ci
COPY resources/ resources/
COPY vite.config.js tailwind.config.js postcss.config.js ./
RUN npm run build

FROM base AS production

COPY --from=composer-deps /var/www/html/vendor ./vendor
COPY . .
RUN composer dump-autoload --optimize --no-dev

COPY --from=npm-build /var/www/html/public/build ./public/build

RUN php artisan config:cache && \
    php artisan route:cache && \
    php artisan view:cache

RUN addgroup -g 1000 -S www && \
    adduser -u 1000 -S www -G www && \
    chown -R www:www /var/www/html/storage /var/www/html/bootstrap/cache

USER www

EXPOSE 9000

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
    CMD php-fpm-healthcheck || exit 1

CMD ["php-fpm"]
