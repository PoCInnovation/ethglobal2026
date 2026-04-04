FROM node:22-alpine

RUN npm install -g serve@14.2.4

WORKDIR /srv

COPY apps/web/public/agent-context.json apps/web/public/agent-context.md apps/web/public/openapi.json ./
RUN mkdir -p agent-context
COPY apps/web/public/agent-context/index.html ./agent-context/index.html

RUN printf '%s\n' \
	'<!DOCTYPE html>' \
	'<html lang="en">' \
	'<head><meta charset="utf-8" /><meta http-equiv="refresh" content="0; url=/agent-context/index.html" />' \
	'<title>Agent Intents Documentation</title></head>' \
	'<body><p>Redirecting to <a href="/agent-context/index.html">documentation</a>…</p></body>' \
	'</html>' \
	> index.html

EXPOSE 3023

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
	CMD node -e "fetch('http://127.0.0.1:3023/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["serve", ".", "-l", "3023", "--no-port-switching"]
