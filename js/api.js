// Supabase REST(PostgREST)를 직접 호출하는 얇은 계층입니다. 외부 라이브러리가 필요 없습니다.
// SUPABASE_URL이 비어 있거나 주소에 ?local=1 이 있으면 localStorage로 동작하는 로컬 모드가 됩니다.
(function () {
  const C = window.CONFIG;
  const forceLocal = /[?&]local=1/.test(location.search);
  const remote = !!(C.SUPABASE_URL && C.SUPABASE_ANON_KEY) && !forceLocal;
  const LS_VOTES = "subin.votes";
  const LS_SKETCHES = "subin.sketches";
  const LS_MINE = "subin.mine"; // 내가 쓴 글의 수정 토큰: { 글id: 토큰 }
  const LS_VENUES = "subin.venues";
  const LS_MINEV = "subin.minev"; // 내가 추가한 가게의 삭제 토큰: { 가게id: 토큰 }

  const headers = remote
    ? {
        apikey: C.SUPABASE_ANON_KEY,
        Authorization: "Bearer " + C.SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
      }
    : {};

  async function rest(path, opts) {
    const res = await fetch(C.SUPABASE_URL.replace(/\/$/, "") + "/rest/v1/" + path, {
      ...opts,
      headers: { ...headers, ...(opts && opts.headers) },
    });
    if (!res.ok) {
      const err = new Error("요청 실패 (" + res.status + "): " + (await res.text()));
      err.status = res.status; // 호출한 쪽에서 원인(403 차단 등)을 구분할 수 있게 합니다
      throw err;
    }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  // 일부 브라우저(비공개 모드 등)는 localStorage 쓰기가 실패합니다. 그래도 저장 자체는 막히지 않도록 메모리에 보관합니다.
  const mem = {};
  const readLS = (k, fallback) => {
    try { return JSON.parse(localStorage.getItem(k) || fallback || "[]"); }
    catch (e) { return mem[k] !== undefined ? mem[k] : JSON.parse(fallback || "[]"); }
  };
  const writeLS = (k, v) => {
    mem[k] = v;
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { console.warn("localStorage 쓰기 실패", e); }
  };

  const uuid = () =>
    crypto.randomUUID
      ? crypto.randomUUID()
      : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
          (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)
        );
  const token = () => uuid().replace(/-/g, "") + uuid().replace(/-/g, "");

  // 그림은 우리가 만든 data URL 형식만 화면에 쓰고, 그 외 값은 버립니다(외부 주소나 스크립트 방지).
  const cleanImage = (s) =>
    typeof s === "string" && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(s) ? s : null;

  // 큰 그림 나눠 올리기: 사내망이 약 50KB 를 넘는 요청을 막으므로, 36KB 조각으로 나눠 보낸 뒤
  // 서버 함수(finish_upload)가 합쳐서 저장합니다. 조각은 3개씩 동시에 보냅니다.
  const PART = 36000;
  async function saveChunked(id, tokenValue, data) {
    const upload = uuid();
    const img = data.image || "";
    const parts = [];
    for (let i = 0; i < img.length; i += PART) parts.push(img.slice(i, i + PART));
    for (let i = 0; i < parts.length; i += 3) {
      await Promise.all(
        parts.slice(i, i + 3).map((d, j) =>
          rest("sketch_parts", {
            method: "POST",
            headers: { Prefer: "return=minimal" },
            body: JSON.stringify({ upload_id: upload, idx: i + j, data: d }),
          })
        )
      );
    }
    const ok = await rest("rpc/finish_upload", {
      method: "POST",
      body: JSON.stringify({
        p_upload: upload, p_parts: parts.length, p_id: id, p_token: tokenValue,
        p_name: data.name, p_message: data.message,
      }),
    });
    if (ok !== true) {
      const err = new Error("조각 저장을 확인하지 못했어요");
      err.status = 500;
      throw err;
    }
  }

  const META = "id,name,message,created_at,updated_at";
  const imgCache = new Map(); // id -> { sig, data }

  const API = {
    mode: remote ? "supabase" : "local",
    cleanImage,

    // ───── 투표 ─────
    async listVotes() {
      if (!remote) return readLS(LS_VOTES);
      return rest("votes?select=poll_id,voter,choices");
    },

    async castVote(pollId, voter, choices) {
      if (!remote) {
        const rows = readLS(LS_VOTES).filter((r) => !(r.poll_id === pollId && r.voter === voter));
        if (choices.length) rows.push({ poll_id: pollId, voter, choices });
        writeLS(LS_VOTES, rows);
        return;
      }
      if (!choices.length) {
        await rest(
          "votes?poll_id=eq." + encodeURIComponent(pollId) + "&voter=eq." + encodeURIComponent(voter),
          { method: "DELETE" }
        );
        return;
      }
      await rest("votes?on_conflict=poll_id,voter", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ poll_id: pollId, voter, choices, updated_at: new Date().toISOString() }),
      });
    },

    // ───── 채티가 추가한 가게 후보 ─────
    // 테이블이 아직 없거나 연결이 불안정해도 투표 화면 자체는 멈추지 않도록, 목록은 실패하면 빈 목록을 돌려줍니다.
    async listVenues() {
      if (!remote) return readLS(LS_VENUES);
      try {
        return await rest("venues?select=id,poll_id,name,note,added_by,created_at&order=created_at.asc");
      } catch (e) {
        console.warn("가게 추가 기능을 불러오지 못했어요", e);
        return [];
      }
    },

    async addVenue(v) {
      const id = uuid();
      const owner_token = token();
      const mine = readLS(LS_MINEV, "{}");
      mine[id] = owner_token;
      writeLS(LS_MINEV, mine);
      try {
        if (!remote) {
          const rows = readLS(LS_VENUES);
          rows.push({ id, created_at: new Date().toISOString(), ...v });
          writeLS(LS_VENUES, rows);
        } else {
          await rest("venues", {
            method: "POST",
            headers: { Prefer: "return=minimal" },
            body: JSON.stringify({ id, owner_token, ...v }),
          });
        }
      } catch (e) {
        const m = readLS(LS_MINEV, "{}");
        delete m[id];
        writeLS(LS_MINEV, m);
        throw e;
      }
      return id;
    },

    isMyVenue(id) {
      return !!readLS(LS_MINEV, "{}")[id];
    },

    async deleteVenue(id) {
      const mine = readLS(LS_MINEV, "{}");
      const t = mine[id];
      if (!t) throw new Error("내가 추가한 가게만 지울 수 있어요");
      if (!remote) {
        writeLS(LS_VENUES, readLS(LS_VENUES).filter((r) => r.id !== id));
      } else {
        const ok = await rest("rpc/delete_venue", {
          method: "POST",
          body: JSON.stringify({ p_id: id, p_token: t }),
        });
        if (ok !== true) throw new Error("삭제 권한이 없어요");
      }
      delete mine[id];
      writeLS(LS_MINEV, mine);
    },

    // ───── 스케치북 ─────
    // 목록은 글만 가볍게 가져옵니다. 그림은 loadImages 로 바뀐 것만 따로 받습니다.
    async listSketchMeta() {
      if (!remote) {
        return readLS(LS_SKETCHES).map(({ id, name, message, created_at, updated_at }) => ({
          id, name, message, created_at, updated_at: updated_at || created_at,
        }));
      }
      return rest("sketches?select=" + META + "&order=created_at.asc");
    },

    async loadImages(rows) {
      const need = rows.filter((r) => {
        const c = imgCache.get(r.id);
        return !c || c.sig !== r.updated_at;
      });
      // 큰 그림이 늘었으므로 한 번에 받는 장수를 줄여 응답 하나가 너무 커지지 않게 합니다.
      for (let i = 0; i < need.length; i += 3) {
        const chunk = need.slice(i, i + 3);
        const got = remote
          ? await rest("sketches?select=id,image&id=in.(" + chunk.map((r) => r.id).join(",") + ")")
          : readLS(LS_SKETCHES).filter((s) => chunk.some((c) => c.id === s.id));
        const byId = {};
        got.forEach((g) => (byId[g.id] = g.image));
        chunk.forEach((r) => imgCache.set(r.id, { sig: r.updated_at, data: cleanImage(byId[r.id]) }));
      }
    },

    // undefined: 아직 못 받음, null: 그림 없음
    imageOf(id) {
      const c = imgCache.get(id);
      return c ? c.data : undefined;
    },

    isMine(id) {
      return !!readLS(LS_MINE, "{}")[id];
    },

    // 재시도해도 같은 글이 되도록 호출하는 쪽에서 id 와 토큰을 한 번만 만들어 넘깁니다.
    newIds() {
      return { _id: uuid(), _token: token() };
    },

    async addSketch(s) {
      const { _id, _token, chunked, ...data } = s;
      const id = _id || uuid();
      const owner_token = _token || token();
      // 응답이 유실돼도 수정 권한을 잃지 않도록, 전송 전에 토큰부터 보관합니다.
      const mine = readLS(LS_MINE, "{}");
      mine[id] = owner_token;
      writeLS(LS_MINE, mine);
      try {
        if (!remote) {
          const rows = readLS(LS_SKETCHES);
          const now = new Date().toISOString();
          rows.push({ id, created_at: now, updated_at: now, ...data });
          writeLS(LS_SKETCHES, rows);
        } else if (chunked) {
          await saveChunked(id, owner_token, data);
        } else {
          await rest("sketches", {
            method: "POST",
            headers: { Prefer: "return=minimal" },
            body: JSON.stringify({ id, owner_token, ...data }),
          });
        }
      } catch (e) {
        if (e.status === 409) return id; // 이미 저장된 글(응답만 유실된 경우)
        const m = readLS(LS_MINE, "{}");
        delete m[id];
        writeLS(LS_MINE, m);
        throw e;
      }
      return id;
    },

    async updateSketch(id, payload) {
      const { _id, _token, chunked, ...s } = payload; // 재시도용 식별값은 수정 내용이 아닙니다
      const t = readLS(LS_MINE, "{}")[id];
      if (!t) throw new Error("내가 쓴 글만 수정할 수 있어요");
      if (!remote) {
        const rows = readLS(LS_SKETCHES).map((r) =>
          r.id === id ? { ...r, ...s, updated_at: new Date().toISOString() } : r
        );
        writeLS(LS_SKETCHES, rows);
        return;
      }
      if (chunked) {
        await saveChunked(id, t, s); // 큰 그림은 조각으로 나눠 올립니다
        return;
      }
      const ok = await rest("rpc/update_sketch", {
        method: "POST",
        body: JSON.stringify({ p_id: id, p_token: t, p_name: s.name, p_message: s.message, p_image: s.image }),
      });
      if (ok !== true) throw new Error("수정 권한이 없어요");
    },

    async deleteSketch(id) {
      const mine = readLS(LS_MINE, "{}");
      const t = mine[id];
      if (!t) throw new Error("내가 쓴 글만 삭제할 수 있어요");
      if (!remote) {
        writeLS(LS_SKETCHES, readLS(LS_SKETCHES).filter((r) => r.id !== id));
      } else {
        const ok = await rest("rpc/delete_sketch", {
          method: "POST",
          body: JSON.stringify({ p_id: id, p_token: t }),
        });
        if (ok !== true) throw new Error("삭제 권한이 없어요");
      }
      delete mine[id];
      writeLS(LS_MINE, mine);
      imgCache.delete(id);
    },

    // 실시간 구독: Realtime 소켓 대신 짧은 주기의 폴링을 씁니다(연결이 끊겨도 안전하고 사내망에서도 동작).
    watch(fetcher, onData, ms) {
      let stop = false;
      const tick = async () => {
        if (stop) return;
        try {
          // 화면이 가려진 탭에서는 요청을 아낍니다.
          if (!document.hidden) onData(await fetcher());
        } catch (e) {
          console.warn(e);
        }
        if (!stop) setTimeout(tick, ms || 3000);
      };
      tick();
      return () => (stop = true);
    },
  };

  window.API = API;
})();
