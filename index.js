const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');

// API Key TMDB của bạn (Đã tích hợp)
const TMDB_API_KEY = process.env.TMDB_API_KEY || 'C018ef237ee1bff06e24516565e4723c';

const manifest = {
  id: 'org.kkphim.stremio.myaddon',
  version: '4.0.0',
  name: 'KKPhim Của Tôi',
  description: 'Tương thích Cinemeta & AIOMetadata với thuật toán quét ID chính xác 100%',
  resources: ['catalog', 'meta', 'stream'],
  types: ['movie', 'series', 'anime'],
  idPrefixes: ['tt', 'tmdb:', 'tvdb:', 'kitsu:', 'mal:', 'tvmaze:', 'kkphim_'],
  catalogs: [
    { type: 'movie', id: 'kk_phim_le', name: 'KKPhim - Phim Lẻ', extra: [{ name: 'search', isRequired: false }, { name: 'skip', isRequired: false }] },
    { type: 'series', id: 'kk_phim_bo', name: 'KKPhim - Phim Bộ', extra: [{ name: 'search', isRequired: false }, { name: 'skip', isRequired: false }] },
    { type: 'series', id: 'kk_hoat_hinh', name: 'KKPhim - Hoạt Hình', extra: [{ name: 'search', isRequired: false }, { name: 'skip', isRequired: false }] },
    { type: 'series', id: 'kk_tv_shows', name: 'KKPhim - TV Shows', extra: [{ name: 'search', isRequired: false }, { name: 'skip', isRequired: false }] }
  ]
};

const builder = new addonBuilder(manifest);

// ----------------------------------------------------
// THUẬT TOÁN BÓC TÁCH ID VÀ SIÊU DỮ LIỆU ĐA NỀN TẢNG
// ----------------------------------------------------
async function resolveInfo(type, baseId) {
  let tmdbId = '';
  let imdbId = '';
  const titles = new Set();
  let year = null;
  const tmdbType = type === 'movie' ? 'movie' : 'tv';

  // 1. Nếu là tt (IMDb), moi thêm thông tin từ Cinemeta
  if (baseId.startsWith('tt')) {
    imdbId = baseId.split(':')[0];
    try {
      const metaRes = await fetch(`https://v3-cinemeta.strem.io/meta/${type}/${imdbId}.json`);
      const metaData = await metaRes.json();
      if (metaData?.meta?.name) titles.add(metaData.meta.name);
      if (metaData?.meta?.year) year = parseInt(metaData.meta.year.toString().split('-')[0]);
    } catch(e) {}
  }

  // 2. Chuyển đổi mọi loại ID sang TMDB để lấy tên chuẩn Tiếng Việt
  if (TMDB_API_KEY) {
    try {
      if (baseId.startsWith('tt')) {
        const r = await fetch(`https://api.themoviedb.org/3/find/${imdbId}?api_key=${TMDB_API_KEY}&external_source=imdb_id`);
        const d = await r.json();
        const res = tmdbType === 'tv' ? d.tv_results : d.movie_results;
        if (res?.length > 0) tmdbId = res[0].id;
      } else if (baseId.startsWith('tmdb:')) {
        tmdbId = baseId.split(':')[1];
      } else if (baseId.startsWith('tvdb:')) {
        const tvdbId = baseId.split(':')[1];
        const r = await fetch(`https://api.themoviedb.org/3/find/${tvdbId}?api_key=${TMDB_API_KEY}&external_source=tvdb_id`);
        const d = await r.json();
        const res = tmdbType === 'tv' ? d.tv_results : d.movie_results;
        if (res?.length > 0) tmdbId = res[0].id;
      }

      if (tmdbId) {
        const viRes = await fetch(`https://api.themoviedb.org/3/${tmdbType}/${tmdbId}?api_key=${TMDB_API_KEY}&language=vi-VN`);
        const viData = await viRes.json();
        if (viData.title) titles.add(viData.title);
        if (viData.name) titles.add(viData.name);
        if (viData.original_title) titles.add(viData.original_title);
        if (viData.original_name) titles.add(viData.original_name);

        const enRes = await fetch(`https://api.themoviedb.org/3/${tmdbType}/${tmdbId}?api_key=${TMDB_API_KEY}&language=en-US`);
        const enData = await enRes.json();
        if (enData.title) titles.add(enData.title);
        if (enData.name) titles.add(enData.name);

        let dateStr = viData.release_date || viData.first_air_date || enData.release_date || enData.first_air_date;
        if (dateStr) {
          const parsedYear = parseInt(dateStr.split('-')[0]);
          if (parsedYear) year = parsedYear;
        }
      }
    } catch(e) {}
  }

  // 3. Fallback cho Anime Kitsu
  if (titles.size === 0 && (baseId.startsWith('kitsu:') || baseId.startsWith('mal:'))) {
     try {
       const r = await fetch(`https://anime-kitsu.strem.fun/meta/anime/${baseId}.json`);
       const d = await r.json();
       if (d?.meta?.name) titles.add(d.meta.name);
       if (d?.meta?.year) year = parseInt(d.meta.year.toString().split('-')[0]);
     } catch(e) {}
  }
  
  return { 
    titles: Array.from(titles).filter(t => t && t.trim().length > 0), 
    year, 
    tmdbId: tmdbId ? tmdbId.toString() : null, 
    imdbId: imdbId ? imdbId : null 
  };
}

// ----------------------------------------------------
// HANDLER CATALOG & META (Giữ nguyên)
// ----------------------------------------------------
builder.defineCatalogHandler(async (args) => {
  const skip = (args.extra && args.extra.skip) ? parseInt(args.extra.skip) : 0;
  const limit = 24;
  const page = Math.floor(skip / limit) + 1;
  let url = '';

  if (args.extra && args.extra.search) {
    url = `https://phimapi.com/v1/api/tim-kiem?keyword=${encodeURIComponent(args.extra.search)}&limit=${limit}&page=${page}`;
  } else {
    const categoryMap = { 'kk_phim_le': 'phim-le', 'kk_phim_bo': 'phim-bo', 'kk_hoat_hinh': 'hoat-hinh', 'kk_tv_shows': 'tv-shows' };
    url = `https://phimapi.com/v1/api/danh-sach/${categoryMap[args.id] || 'phim-le'}?limit=${limit}&page=${page}`;
  }

  try {
    const res = await fetch(url);
    const data = await res.json();
    const items = data.data ? data.data.items : (data.items || []);
    const metas = items.map(m => {
      let poster = m.poster_url;
      if (poster && !poster.startsWith('http')) poster = `https://phimimg.com/${poster}`;
      return { id: `kkphim_${m.slug}`, type: args.type, name: m.name, poster, description: `Tên gốc: ${m.origin_name} (${m.year})` };
    });
    return { metas };
  } catch (e) { return { metas: [] }; }
});

builder.defineMetaHandler(async (args) => {
  if (!args.id.startsWith('kkphim_')) return { meta: null };
  const slug = args.id.split(':')[0].replace('kkphim_', '');
  try {
    const res = await fetch(`https://phimapi.com/phim/${slug}`);
    const data = await res.json();
    const movie = data.movie;
    const isSeries = movie.type !== 'single';

    let meta = {
      id: args.id.split(':')[0], type: isSeries ? 'series' : 'movie', name: movie.name,
      poster: movie.poster_url, background: movie.thumb_url,
      description: movie.content ? movie.content.replace(/<[^>]*>/g, '') : '',
      year: parseInt(movie.year) || undefined, genres: movie.category ? movie.category.map(c => c.name) : []
    };

    if (isSeries && data.episodes) {
      meta.videos = [];
      data.episodes.forEach(server => {
        server.server_data.forEach(ep => {
          const epNumber = parseInt(ep.name.replace(/\D/g, '')) || 1;
          const videoId = `${meta.id}:${ep.slug}`;
          if (!meta.videos.find(v => v.id === videoId)) meta.videos.push({ id: videoId, title: ep.name, season: 1, episode: epNumber });
        });
      });
    }
    return { meta };
  } catch (e) { return { meta: null }; }
});

// ----------------------------------------------------
// STREAM HANDLER (THUẬT TOÁN CHẤM ĐIỂM VÀ LỌC ID SÂU)
// ----------------------------------------------------
builder.defineStreamHandler(async (args) => {
  let slug = '';
  let targetSeason = null;
  let targetEpisode = null;
  let targetEpisodeSlug = null;

  if (args.id.startsWith('kkphim_')) {
    const parts = args.id.split(':');
    slug = parts[0].replace('kkphim_', '');
    if (parts.length > 1) targetEpisodeSlug = parts[1];
  } else {
    try {
      const parts = args.id.split(':');
      let baseId = '';

      if (args.id.startsWith('tt')) {
        baseId = parts[0];
        if (parts.length > 2) { targetSeason = parseInt(parts[1]); targetEpisode = parseInt(parts[2]); }
      } else {
        baseId = `${parts[0]}:${parts[1]}`;
        if (parts.length > 3) { targetSeason = parseInt(parts[2]); targetEpisode = parseInt(parts[3]); }
      }

      // 1. Lấy toàn bộ siêu dữ liệu chuẩn
      const info = await resolveInfo(args.type, baseId);
      
      // 2. Tìm kiếm ứng viên từ nhiều tên gọi
      let allItems = new Map();
      for (const title of info.titles) {
        // Xóa dấu để tránh lỗi khi tìm kiếm
        const cleanTitle = title.replace(/[:\-]/g, ' ').replace(/\s+/g, ' ').trim();
        try {
            const searchRes = await fetch(`https://phimapi.com/v1/api/tim-kiem?keyword=${encodeURIComponent(cleanTitle)}&limit=15`);
            const searchData = await searchRes.json();
            const items = searchData.data ? searchData.data.items : (searchData.items || []);
            items.forEach(it => allItems.set(it.slug, it));
        } catch(e) {}
      }

      let candidates = Array.from(allItems.values());

      if (candidates.length > 0) {
        // Sắp xếp ưu tiên ứng viên có năm khớp nhất
        candidates.sort((a, b) => {
          let aYearDiff = info.year && a.year ? Math.abs(a.year - info.year) : 100;
          let bYearDiff = info.year && b.year ? Math.abs(b.year - info.year) : 100;
          return aYearDiff - bYearDiff;
        });

        const topCandidates = candidates.slice(0, 8); // Chỉ lấy 8 phim sát nhất

        // Tải chi tiết 8 phim cùng lúc để kiểm tra mã ID (Siêu tốc độ)
        const detailPromises = topCandidates.map(async (item) => {
           try {
             const r = await fetch(`https://phimapi.com/phim/${item.slug}`);
             const d = await r.json();
             return d.movie ? { ...item, detail: d.movie } : item;
           } catch(e) { return item; }
        });
        
        const detailedCandidates = await Promise.all(detailPromises);
        let bestScore = -1;

        // 3. THUẬT TOÁN CHẤM ĐIỂM
        for (let item of detailedCandidates) {
          let score = 0;
          
          // [TIÊU CHÍ VÀNG]: Trùng khớp ID ẩn (TMDB hoặc IMDb) thưởng 10.000 điểm
          if (item.detail?.tmdb?.id && info.tmdbId) {
             if (item.detail.tmdb.id.toString() === info.tmdbId) score += 10000;
          }
          if (item.detail?.imdb?.id && info.imdbId) {
             if (item.detail.imdb.id === info.imdbId) score += 10000;
          }

          // Tiêu chí Năm phát hành
          if (info.year && item.year) {
             const diff = Math.abs(item.year - info.year);
             if (diff === 0) score += 50;
             else if (diff === 1) score += 20; 
          }

          // Tiêu chí Season (Mùa) - Phân tách Season 1 và Season 2
          const nameStr = (item.name + ' ' + item.origin_name).toLowerCase();
          const reqSeason = targetSeason || 1;
          const isSeriesTarget = (args.type === 'series' || targetSeason);
          
          if (isSeriesTarget) {
              const sRegex1 = new RegExp(`phần ${reqSeason}\\b`, 'i');
              const sRegex2 = new RegExp(`season ${reqSeason}\\b`, 'i');
              const sRegex3 = new RegExp(`phần 0${reqSeason}\\b`, 'i');
              
              if (sRegex1.test(nameStr) || sRegex2.test(nameStr) || sRegex3.test(nameStr)) {
                 score += 100; // Trúng đúng Season thưởng điểm
              } else if (reqSeason === 1) {
                 if (/(phần|season)\s*(2|3|4|5|6|7|8|9)/i.test(nameStr)) {
                    score -= 100; // Đang xem S1 nhưng phim này ghi S2 -> Phạt
                 } else {
                    score += 20; // Phim bộ VN không ghi Season thường mặc định là S1
                 }
              } else {
                 score -= 100; // Tìm S2 nhưng không thấy ghi S2
              }
          } else {
             // Đang xem phim lẻ mà kết quả ra phim bộ -> Phạt nặng
             if (/(phần|season)\s*\d+/i.test(nameStr) || item.detail?.type === 'series') {
                score -= 100;
             }
          }

          // Chọn phim điểm cao nhất
          if (score > bestScore) {
             bestScore = score;
             slug = item.slug;
          }
        }
      }
    } catch (e) {
      return { streams: [] };
    }
  }

  if (!slug) return { streams: [] };

  try {
    const res = await fetch(`https://phimapi.com/phim/${slug}`);
    const data = await res.json();
    const streams = [];

    if (data.episodes) {
      data.episodes.forEach(server => {
        server.server_data.forEach(ep => {
          let isMatch = true;

          if (targetEpisode) {
            const epMatch = ep.name.match(/\d+/);
            const epNumber = epMatch ? parseInt(epMatch[0]) : null;

            isMatch = (epNumber === targetEpisode ||
                       ep.slug === `tap-${targetEpisode}` ||
                       ep.slug === `tap-0${targetEpisode}`);
          } else if (targetEpisodeSlug) {
            isMatch = (ep.slug === targetEpisodeSlug);
          }

          if (isMatch && ep.link_m3u8) {
            streams.push({
              title: `[KKPhim] ${server.server_name}\n${ep.name}`,
              url: ep.link_m3u8,
              behaviorHints: { notWebReady: true }
            });
          }
        });
      });
    }

    return { streams };
  } catch (e) {
    return { streams: [] };
  }
});

const PORT = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: PORT, host: '0.0.0.0' });
