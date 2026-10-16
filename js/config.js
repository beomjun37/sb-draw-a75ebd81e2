// 배포 전에 Supabase 값을 채워 넣으면 실시간 모드로 동작합니다.
// 비워 두면 브라우저 localStorage로 동작하는 로컬 미리보기 모드가 됩니다.
window.CONFIG = {
  SUPABASE_URL: "https://sjuwcgvbdrvtggitdxtq.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNqdXdjZ3ZiZHJ2dGdnaXRkeHRxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE5NDY1NjUsImV4cCI6MjEwNzUyMjU2NX0.-tQZ4iuv9GFLO9TFbw887R6Au23POD0EjHHYbDq4pec",

  COUPLE: {
    bride: "수빈",
    groom: "준혁",
    date: "2026-10-17T11:00:00+09:00",
    place: "브라이튼하우스 강남",
  },

  // 투표 마감 시각(ISO). 비워 두면 마감 없이 계속 열려 있습니다.
  POLL_CLOSE: "2026-10-16T18:00:00+09:00",

  // 스케치북 작성 마감 시각(ISO). 비워 두면 마감 없이 언제나 쓸 수 있습니다. 설정하면 이후에는 새 글, 수정, 삭제가 막히고 갤러리는 계속 볼 수 있습니다.
  BOOK_CLOSE: "",
};
