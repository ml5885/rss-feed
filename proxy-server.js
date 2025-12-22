const http = require("node:http");
const { Readable } = require("node:stream");

const PORT = Number(process.env.PORT || 8787);

function setCors(res) {
	res.setHeader("Access-Control-Allow-Origin", "*");
	res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
	res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
	res.setHeader("Access-Control-Max-Age", "86400");
}

function isAllowedTarget(u) {
	// Basic safety: only http(s), and block obvious local targets.
	if (!u) return false;
	if (!(u.protocol === "http:" || u.protocol === "https:")) return false;
	const h = (u.hostname || "").toLowerCase();
	if (h === "localhost" || h === "127.0.0.1" || h === "::1") return false;
	return true;
}

const server = http.createServer(async (req, res) => {
	try {
		setCors(res);

		if (req.method === "OPTIONS") {
			res.writeHead(204);
			return res.end();
		}

		const url = new URL(req.url, `http://localhost:${PORT}`);
		if (url.pathname !== "/proxy") {
			res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
			return res.end("Not found");
		}

		const target = url.searchParams.get("url");
		let targetUrl;
		try {
			targetUrl = new URL(target);
		} catch {
			res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
			return res.end("Invalid url");
		}

		if (!isAllowedTarget(targetUrl)) {
			res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
			return res.end("Blocked target");
		}

		const upstream = await fetch(targetUrl.href, {
			redirect: "follow",
			headers: {
				accept:
					"application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
				"user-agent": "reader-local-proxy",
			},
		});

		// Mirror status; forward a few useful headers.
		const headers = {
			"Content-Type":
				upstream.headers.get("content-type") || "application/octet-stream",
			"Cache-Control": "no-store",
		};

		res.writeHead(upstream.status, headers);

		if (!upstream.body) return res.end();

		// Stream response to avoid buffering huge feeds.
		Readable.fromWeb(upstream.body).pipe(res);
	} catch (err) {
		res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
		res.end("Proxy error");
	}
});

server.listen(PORT, () => {
	console.log(
		`Local CORS proxy listening on http://localhost:${PORT}/proxy?url=...`
	);
});
