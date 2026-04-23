// Mock Dockerfile content for demo purposes
export const SAMPLE_DOCKERFILE = `FROM node:latest

RUN apt-get update && apt-get install -y curl

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]`;

// Mock docker-compose.yml content for demo purposes
export const SAMPLE_DOCKER_COMPOSE = `version: '3.8'

services:
  web:
    image: nginx:alpine
    ports:
      - "8080:80"
    volumes:
      - ./html:/usr/share/nginx/html
    networks:
      - app-network

  api:
    image: node:18-alpine
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgres://db:5432
    depends_on:
      - db
    networks:
      - app-network

  db:
    image: postgres:15-alpine
    ports:
      - "5432:5432"
    environment:
      - POSTGRES_PASSWORD=secretpassword
      - POSTGRES_DB=myapp
    volumes:
      - postgres-data:/var/lib/postgresql/data
    networks:
      - app-network

networks:
  app-network:
    driver: bridge

volumes:
  postgres-data:`;

// Mock analysis results generator
export function generateMockResults() {
  return {
    score: 72,
    grade: 'B',
    errors: [
      {
        line: 3,
        code: 'DL3008',
        severity: 'error',
        message: 'Pin versions in apt get install',
        suggestion: 'Use apt-get install package=version to pin package versions for reproducible builds'
      }
    ],
    warnings: [
      {
        line: 8,
        code: 'DL3009',
        severity: 'warning',
        message: 'Delete the apt-get lists after installing something',
        suggestion: 'Add && rm -rf /var/lib/apt/lists/* after apt-get to reduce image size'
      },
      {
        line: 12,
        code: 'DL3045',
        severity: 'warning',
        message: 'COPY to a relative destination without WORKDIR set',
        suggestion: 'Set WORKDIR before using COPY with relative paths to avoid confusion'
      }
    ],
    suggestions: [
      {
        line: 1,
        code: 'DL3006',
        severity: 'info',
        message: 'Use a specific image tag instead of latest',
        suggestion: 'Replace FROM node:latest with FROM node:18-alpine for reproducible builds'
      },
      {
        line: 15,
        code: 'DL3025',
        severity: 'info',
        message: 'Use multi-stage builds to reduce image size',
        suggestion: 'Consider using multi-stage builds to create smaller final images'
      },
      {
        line: 10,
        code: 'DL3020',
        severity: 'info',
        message: 'Use COPY instead of ADD for files and folders',
        suggestion: 'ADD should only be used for extracting archives or fetching from URLs'
      }
    ],
    securityIssues: [
      {
        line: 5,
        code: 'DL3002',
        severity: 'warning',
        message: 'Do not run containers as root user',
        suggestion: 'Add USER directive to run container as non-root user for better security'
      }
    ]
  };
}

// Mock project structure
export const SAMPLE_PROJECT_STRUCTURE = [
  { name: 'src/', type: 'folder', size: '-' },
  { name: 'src/index.js', type: 'file', size: '2.4 KB' },
  { name: 'src/server.js', type: 'file', size: '3.1 KB' },
  { name: 'src/routes/', type: 'folder', size: '-' },
  { name: 'src/routes/api.js', type: 'file', size: '5.7 KB' },
  { name: 'public/', type: 'folder', size: '-' },
  { name: 'public/index.html', type: 'file', size: '1.2 KB' },
  { name: 'package.json', type: 'file', size: '0.8 KB' },
  { name: 'Dockerfile', type: 'file', size: '0.5 KB' },
  { name: '.dockerignore', type: 'file', size: '0.1 KB' },
  { name: 'README.md', type: 'file', size: '1.5 KB' },
];

// Mock Docker build logs
export const MOCK_BUILD_LOGS = [
  { step: 1, message: 'Sending build context to Docker daemon', status: 'completed' },
  { step: 2, message: 'Step 1/8 : FROM node:18-alpine', status: 'completed' },
  { step: 3, message: 'Pulling from library/node', status: 'completed' },
  { step: 4, message: 'Step 2/8 : WORKDIR /app', status: 'completed' },
  { step: 5, message: 'Step 3/8 : COPY package*.json ./', status: 'completed' },
  { step: 6, message: 'Step 4/8 : RUN npm install --production', status: 'in-progress' },
  { step: 7, message: 'Step 5/8 : COPY . .', status: 'pending' },
  { step: 8, message: 'Step 6/8 : EXPOSE 3000', status: 'pending' },
  { step: 9, message: 'Step 7/8 : USER node', status: 'pending' },
  { step: 10, message: 'Step 8/8 : CMD ["node", "server.js"]', status: 'pending' },
];

// Mock image layers
export const MOCK_IMAGE_LAYERS = [
  { id: 'sha256:4a1c4b', command: 'FROM node:18-alpine', size: '118 MB', created: '2 hours ago' },
  { id: 'sha256:7b2e3f', command: 'WORKDIR /app', size: '0 B', created: '5 minutes ago' },
  { id: 'sha256:9d4a1c', command: 'COPY package*.json ./', size: '2.4 KB', created: '5 minutes ago' },
  { id: 'sha256:3e7b2a', command: 'RUN npm install --production', size: '45.2 MB', created: '4 minutes ago' },
  { id: 'sha256:8c9d3e', command: 'COPY . .', size: '12.8 KB', created: '3 minutes ago' },
  { id: 'sha256:1f2a4c', command: 'EXPOSE 3000', size: '0 B', created: '3 minutes ago' },
  { id: 'sha256:6b8d2e', command: 'USER node', size: '0 B', created: '3 minutes ago' },
  { id: 'sha256:4d9e1a', command: 'CMD ["node", "server.js"]', size: '0 B', created: '3 minutes ago' },
];

// Mock runtime metrics generator
export function generateRuntimeMetrics() {
  return {
    cpu: Math.floor(Math.random() * 40) + 10, // 10-50%
    memory: Math.floor(Math.random() * 300) + 100, // 100-400 MB
    memoryLimit: 512, // MB
    networkRx: (Math.random() * 10).toFixed(2), // KB/s
    networkTx: (Math.random() * 5).toFixed(2), // KB/s
    diskRead: (Math.random() * 20).toFixed(2), // MB/s
    diskWrite: (Math.random() * 10).toFixed(2), // MB/s
    uptime: Math.floor(Math.random() * 3600) + 300, // seconds
  };
}

// Mock service metrics for compose
export function generateServiceMetrics(serviceName: string) {
  return {
    name: serviceName,
    status: 'running',
    cpu: Math.floor(Math.random() * 30) + 5,
    memory: Math.floor(Math.random() * 200) + 50,
    networkRx: (Math.random() * 5).toFixed(2),
    networkTx: (Math.random() * 3).toFixed(2),
    uptime: Math.floor(Math.random() * 3600) + 300,
  };
}