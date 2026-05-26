export const nginx = {
    token: function (stream) {
        if (stream.eatSpace()) return null;

        var ch = stream.peek();

        
        if (ch == "#") {
            stream.skipToEnd();
            return "comment";
        }

        
        if (ch == "{" || ch == "}") {
            stream.next();
            return "bracket";
        }

        
        if (ch == ";") {
            stream.next();
            return "punctuation";
        }

        
        if (ch == "$") {
            stream.next();
            if (stream.match(/^[a-zA-Z0-9_]+/)) {
                return "variableName";
            }
            return null;
        }

        
        if (ch == '"' || ch == "'") {
            stream.next();
            if (stream.skipTo(ch)) {
                stream.next();
                return "string";
            } else {
                stream.skipToEnd();
                return "error";
            }
        }

        
        if (stream.match(/^(server|location|listen|server_name|root|index|error_page|access_log|error_log|proxy_pass|proxy_set_header|upstream|include|rewrite|return|if|set|try_files|fastcgi_pass|fastcgi_param|client_max_body_size|gzip|ssl_certificate|ssl_certificate_key|ssl_protocols|ssl_ciphers|add_header|expires|charset|autoindex|deny|allow|auth_basic|auth_basic_user_file|limit_req|limit_conn|worker_processes|worker_connections|keepalive_timeout|sendfile|tcp_nopush|tcp_nodelay|types_hash_max_size|default_type|log_format|pid|user|events|http|stream|mail)\b/)) {
            return "keyword";
        }

        
        if (stream.match(/^(on|off)\b/)) {
            return "atom";
        }

        
        if (stream.match(/^-?\d+(\.\d+)?[kmgKMG]?\b/)) {
            return "number";
        }

        
        if (stream.match(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?/)) {
            return "number";
        }

        
        if (ch == "~") {
            stream.next();
            if (stream.peek() == "*") {
                stream.next();
            }
            return "operator";
        }

        
        if (ch == "=" || ch == "!") {
            stream.next();
            if (stream.peek() == "=") {
                stream.next();
            }
            return "operator";
        }

        
        if (stream.match(/^[^\s;{}#]+/)) {
            return "string";
        }

        stream.next();
        return null;
    },
    startState: function () {
        return {};
    },
    languageData: {
        commentTokens: { line: "#" }
    }
};
