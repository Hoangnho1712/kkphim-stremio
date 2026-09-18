const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');

// Đã tích hợp API Key TMDB của bạn
const TMDB_API_KEY = process.env.TMDB_API_KEY || 'C018ef237ee1bff06e24516565e4723c';

const manifest = {
  id: 'org.kkphim.stremio.myaddon',
  version: '3.3.1',
  name: 'KKPhim Của Tôi',
  description: 'Tương thích Cinemeta, TMDB & AIOMetadata (Đã tích hợp API)',
  resources: ['catalog', 'meta', 'stream'],
  types: ['movie', 'series', 'anime'],
  // Hỗ trợ đầy đủ IDPrefixes từ AIOMetadata
  idPrefixes: ['tt', 'tmdb:', 'tvdb:', 'kitsu:', 'mal:', 'tvmaze:', 'kkphim_'],
  catalogs: [
    {
      type: 'movie',
      id: 'kk_phim_le',
      name: 'KKPhim - Phim Lẻ',
      extra: [{ name: 'search', isRequired: false }, { name: 'skip', isRequired: false }]
    },
    {
      type: 'series',
      id: 'kk_phim_bo',
      name: 'KKPhim - Phim Bộ',
      extra: [{ name: 'search', isRequired: false }, { name: 'skip', isRequired: false }]
    },
    {
      type: 'series',
      id: 'kk_hoat_hinh',
      name: 'KKPhim - Hoạt Hình',
      extra: [{ name: 'search', isRequired: false }, { name: 'skip', isRequired: false }]
    },
    {
      type: 'series',
      id: 'kk_tv_shows',
      name: 'KKPhim - TV Shows',
      extra: [{ name: 'search', isRequired: false }, { name: 'skip', isRequired: false }]
    }
  ]
};

const builder = new addonBuilder(manifest);

// Hàm tra cứu tên phim từ các loại ID (IMDb, TMDB, TVDb)
async function resolveTitles(type, baseId) {
  const titles = new Set();
  const tmdbType = type === 'movie' ? 'movie' : 'tv';

  // 1. Thử lấy từ Cinemeta nếu là ID tt
  if (baseId.startsWith('tt')) {
    try {
      const metaRes = await fetch(`https://v3-cinemeta.strem.io/meta/${type}/${baseId}.json`);
      const metaData = await metaRes.json();
      if (metaData?.meta?.name) titles.add(metaData.meta.name);
    } catch (e) {}
  }

  // 2. Tra cứu qua TMDB API để lấy tên Việt + tên gốc
  if (TMDB_API_KEY) {
    try {
      let tmdbId = '';

      if (baseId.startsWith('tt')) {
        const r = await fetch(`https://api.themoviedb.org/3/find/${baseId}?api_key=${TMDB_API_KEY}&external_source=imdb_id`);
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
        // Lấy tên tiếng Việt và tiếng Anh
        const viRes = await fetch(`https://api.themoviedb.org/3/${tmdbType}/${tmdbId}?api_key=${TMDB_API_KEY}&language=vi-VN`);
        const viData = await viRes.json();
        if (viData.title) titles.add(viData.title);
        if (viData.name) titles.add(viData.name);
        if (viData.original_title) titles.add(viData.original_title);
        if (viData.original_name) titles.add(viData.original_name);
      }
    } catch (e) {}
  }

  return titles;
}

// 1. Catalog Handler
builder.defineCatalogHandler(async (args) => {
  const skip = (args.extra && args.extra.skip) ? parseInt(args.extra.skip) : 0;
  const limit = 24;
  const page = Math.floor(skip / limit) + 1;
  let url = '';

  if (args.extra && args.extra.search) {
    const keyword = encodeURIComponent(args.extra.search);
    url = `https://phimapi.com/v1/api/tim-kiem?keyword=${keyword}&limit=${limit}&page=${page}`;
  } else {
    const categoryMap = {
      'kk_phim_le': 'phim-le',
      'kk_phim_bo': 'phim-bo',
      'kk_hoat_hinh': 'hoat-hinh',
      'kk_tv_shows': 'tv-shows'
    };
    const slug = categoryMap[args.id] || 'phim-le';
    url = `https://phimapi.com/v1/api/danh-sach/${slug}?limit=${limit}&page=${page}`;
  }

  try {
    const res = await fetch(url);
    const data = await res.json();
    const items = data.data ? data.data.items : (data.items || []);

    const metas = items.map(m => {
      let posterUrl = m.poster_url;
      if (posterUrl && !posterUrl.startsWith('http')) {
        posterUrl = `https://phimimg.com/${posterUrl}`;
      }
      return {
        id: `kkphim_${m.slug}`,
        type: args.type,
        name: m.name,
        poster: posterUrl,
        description: `Tên gốc: ${m.origin_name} (${m.year})`
      };
    });

    return { metas };
  } catch (e) {
    return { metas: [] };
  }
});

// 2. Meta Handler
builder.defineMetaHandler(async (args) => {
  if (!args.id.startsWith('kkphim_')) return { meta: null };
  
  const slug = args.id.split(':')[0].replace('kkphim_', '');
  
  try {
    const res = await fetch(`https://phimapi.com/phim/${slug}`);
    const data = await res.json();
    const movie = data.movie;
    const isSeries = movie.type !== 'single';

    let meta = {
      id: args.id.split(':')[0],
      type: isSeries ? 'series' : 'movie',
      name: movie.name,
      poster: movie.poster_url,
      background: movie.thumb_url,
      description: movie.content ? movie.content.replace(/<[^>]*>/g, '') : '',
      year: parseInt(movie.year) || undefined,
      genres: movie.category ? movie.category.map(c => c.name) : []
    };

    if (isSeries && data.episodes) {
      meta.videos = [];
      data.episodes.forEach(server => {
        server.server_data.forEach(ep => {
          const epNumber = parseInt(ep.name.replace(/\D/g, '')) || 1;
          const videoId = `${meta.id}:${ep.slug}`;
          if (!meta.videos.find(v => v.id === videoId)) {
            meta.videos.push({
              id: videoId,
              title: ep.name,
              season: 1,
              episode: epNumber
            });
          }
        });
      });
    }

    return { meta };
  } catch (e) {
    return { meta: null };
  }
});

// 3. Stream Handler (Hỗ trợ AIOMetadata & Nhiều nguồn ID)
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

      // Tách baseId, season, episode tùy theo tiền tố ID
      if (args.id.startsWith('tt')) {
        baseId = parts[0];
        if (parts.length > 2) {
          targetSeason = parseInt(parts[1]);
          targetEpisode = parseInt(parts[2]);
        }
      } else {
        // Định dạng kiểu tmdb:12345:1:2 hoặc tvdb:12345:1:2
        baseId = `${parts[0]}:${parts[1]}`;
        if (parts.length > 3) {
          targetSeason = parseInt(parts[2]);
          targetEpisode = parseInt(parts[3]);
        }
      }

      const queryTitles = await resolveTitles(args.type, baseId);

      let candidates = [];
      for (const title of queryTitles) {
        if (!title) continue;
        const searchRes = await fetch(`https://phimapi.com/v1/api/tim-kiem?keyword=${encodeURIComponent(title)}&limit=24`);
        const searchData = await searchRes.json();
        const items = searchData.data ? searchData.data.items : (searchData.items || []);

        if (items.length > 0) {
          candidates = items;
          break;
        }
      }

      if (candidates.length > 0) {
        let matched = candidates[0];

        // Tìm đúng season
        if (targetSeason && targetSeason > 1) {
          const s1 = new RegExp(`phần ${targetSeason}`, 'i');
          const s2 = new RegExp(`season ${targetSeason}`, 'i');
          const s3 = new RegExp(`phần 0${targetSeason}`, 'i');
          const s4 = new RegExp(`p${targetSeason}`, 'i');

          const found = candidates.find(item => {
            const n = item.name || '';
            const o = item.origin_name || '';
            return s1.test(n) || s2.test(n) || s3.test(n) || s4.test(n) ||
                   s1.test(o) || s2.test(o) || s3.test(o) || s4.test(o);
          });

          if (found) matched = found;
        }

        slug = matched.slug;
      } else {
        return { streams: [] };
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
              behaviorHints: {
                notWebReady: true
              }
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
