export const ini = {
    token: function (stream, state) {
        if (stream.sol()) {
            state.inValue = false;
        }

        if (stream.eatSpace()) return null;

        var ch = stream.peek();

        
        if (ch == ";" || ch == "#") {
            stream.skipToEnd();
            return "comment";
        }

        
        if (ch == "[") {
            if (stream.match(/^\[[^\]]*\]/)) {
                return "def";
            }
        }

        
        if (!state.inValue) {
            if (stream.match(/^[a-zA-Z0-9_.-]+(?=\s*=)/)) {
                return "variable";
            }
            if (ch == "=") {
                stream.next();
                state.inValue = true;
                return "operator";
            }
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

        
        if (stream.match(/^-?\d+(\.\d+)?(?=(\s|$))/)) {
            return "number";
        }

        
        if (stream.match(/^(true|false|on|off|yes|no|null)\b/i)) {
            return "keyword";
        }
        if (state.inValue) {
            if (stream.match(/^[^;#]+/)) {
                return "string";
            }
        }

        stream.next();
        return null;
    },
    startState: function () {
        return {
            inValue: false
        };
    },
    languageData: {
        commentTokens: { line: ";" }
    }
};
