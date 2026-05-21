FROM alpine

RUN apk --no-cache add zip
ENV TZ=Asia/Shanghai

COPY ./docker /home/environment
RUN chmod -R +x /home/environment

COPY ./builder/server /home/rangine
COPY ./config.yaml /home/config.yaml

RUN mkdir -p /home/site-manager && chmod 755 /home/site-manager
RUN mkdir -p /home/site-manager/db


EXPOSE 8000

CMD ["/home/rangine", "server:start" ,"-f", "/home/config.yaml"]