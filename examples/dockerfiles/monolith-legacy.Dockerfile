# Legacy monolithic application - many layers, no multi-stage
# Expect: low-medium score, many warnings about layer count and practices
FROM centos:7

RUN yum update -y
RUN yum install -y epel-release
RUN yum install -y java-11-openjdk java-11-openjdk-devel
RUN yum install -y maven
RUN yum install -y nodejs npm
RUN yum install -y python3 python3-pip
RUN yum install -y nginx
RUN yum install -y redis
RUN yum install -y supervisor
RUN yum install -y wget curl git unzip
RUN yum install -y gcc gcc-c++ make automake
RUN yum install -y mysql-devel postgresql-devel
RUN yum install -y ImageMagick ImageMagick-devel
RUN yum install -y ffmpeg
RUN yum install -y chromium chromedriver
RUN yum clean all

ENV JAVA_HOME=/usr/lib/jvm/java-11-openjdk
ENV PATH=$JAVA_HOME/bin:$PATH
ENV MAVEN_OPTS="-Xmx2048m"

WORKDIR /opt/app

COPY pom.xml .
RUN mvn dependency:resolve

COPY package.json package-lock.json ./
RUN npm install

COPY requirements.txt .
RUN pip3 install -r requirements.txt

COPY . .

RUN mvn package -DskipTests
RUN npm run build
RUN python3 manage.py collectstatic --noinput

COPY config/nginx.conf /etc/nginx/nginx.conf
COPY config/supervisord.conf /etc/supervisord.conf
COPY config/redis.conf /etc/redis.conf

RUN mkdir -p /var/log/app /var/run/app /opt/app/uploads /opt/app/tmp
RUN chmod -R 777 /var/log/app /var/run/app /opt/app/uploads /opt/app/tmp

EXPOSE 80 443 3000 8080 8443 6379

VOLUME ["/opt/app/uploads", "/var/log/app", "/opt/app/data"]

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisord.conf"]
