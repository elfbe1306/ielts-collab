import { Database } from "@hocuspocus/extension-database";
import { Server } from "@hocuspocus/server";

const SPRING_API_URL = process.env.SPRING_API_URL;
const INTERNAL_SECRET = process.env.INTERNAL_SECRET;

if (!SPRING_API_URL || !INTERNAL_SECRET) {
    throw new Error("Thiếu SPRING_API_URL hoặc INTERNAL_SECRET trong .env");
}

// "writing:{assignmentId}:{userId}" -> { assignmentId, userId }; tên sai dạng thì trả về null
function parseDocumentName(documentName) {
    const match = /^writing:([0-9a-f-]{36}):([0-9a-f-]{36})$/i.exec(documentName);
    return match ? { assignmentId: match[1], userId: match[2] } : null;
}

// "presence:{assignmentId}" — document rỗng, chỉ dùng awareness để biết ai đang online
function isPresenceDocument(documentName) {
    return /^presence:[0-9a-f-]{36}$/i.test(documentName);
}

async function callSpring(path, options = {}) {
    return fetch(`${SPRING_API_URL}/internal/writing-submissions/${path}`, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            "X-Internal-Secret": INTERNAL_SECRET,
            ...options.headers,
        },
    });
}

const server = new Server({
    port: 1234,
    debounce: 3000,
    maxDebounce: 15000,
    extensions: [
        new Database({
            fetch: async ({ documentName }) => {
                if (isPresenceDocument(documentName)) return null;

                const ids = parseDocumentName(documentName);
                if (!ids) throw new Error(`Tên tài liệu không hợp lệ: ${documentName}`);

                const response = await callSpring(`${ids.assignmentId}/${ids.userId}`);

                if (!response.ok) {
                    throw new Error(`Tải bài thất bại (${response.status}) cho ${documentName}`);
                }

                const { content } = await response.json();

                if (!content) return null;

                return new Uint8Array(Buffer.from(content, "base64"));
            },

            store: async ({ document, documentName, state }) => {
                if (isPresenceDocument(documentName)) return;

                const ids = parseDocumentName(documentName);
                if (!ids) return;

                const response = await callSpring(`${ids.assignmentId}/${ids.userId}`, {
                    method: "PUT",
                    body: JSON.stringify({ content: Buffer.from(state).toString("base64") }),
                });

                if (!response.ok) {
                    throw new Error(`Lưu bài thất bại (${response.status}) cho ${documentName}`);
                }

                document.broadcastStateless(JSON.stringify({ type: "saved" }));

                console.log(`Đã lưu ${documentName} (${state.length} byte)`);
            },
        }),
    ],
});

server.listen();