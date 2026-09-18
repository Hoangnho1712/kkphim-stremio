const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');

// Chú ý: Nếu bạn deploy lên Render/Vercel dùng Node.js v18 trở lên, 
// không cần require('node-fetch') vì Node đã có sẵn fetch. 
// Nếu code chạy báo lỗi thiếu fetch, hãy bỏ dấu // ở dòng bên dưới:
// const fetch = require('node-fetch');

const manifest = {
  id: 'org.kkphim.stremio.myaddon',
  version: '3.1.3',
  name: 'KKPhim Của Tôi',
  description: 'Tích hợp KKPhim vào Cinemeta / TMDB (Phim Lẻ & Phim Bộ)',
  resources: ['catalog', 'meta', 'stream'],
  types: ['movie', 'series'],
  idPrefixes: ['tt', 'tmdb:', 'kkphim_'],
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

// 1. Catalog Handler
builder.defineCatalogHandler(async (args) => {
  let url = '';
  const skip = (args.extra && args.extra.skip) ? parseInt(args.extra.skip) : 0;
  const limit = 24;
  const page = Math.floor(skip / limit) + 1;

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

// 2. Meta Handler (Tạo danh sách tập cho phim bộ)
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

// 3. Stream Handler (Hỗ trợ IMDb, TMDB và Catalog KKPhim)
builder.defineStreamHandler(async (args) => {
  let slug = '';
  let targetEpisode = null;      
  let targetEpisodeSlug = null;  

  // TRƯỜNG HỢP 1: Phim từ Cinemeta (IMDb) hoặc TMDB
  if (args.id.startsWith('tt') || args.id.startsWith('tmdb:')) {
    try {
      const parts = args.id.split(':');
      let metaId = '';
      
      if (args.id.startsWith('tt')) {
        metaId = parts[0]; 
        if (parts.length > 2) targetEpisode = parts[2]; 
      } 
      else if (args.id.startsWith('tmdb:')) {
        metaId = `${parts[0]}:${parts[1]}`; 
        if (parts.length > 3) targetEpisode = parts[3]; 
      }

      const metaRes = await fetch(`https://v3-cinemeta.strem.io/meta/${args.type}/${metaId}.json`);
      const metaData = await metaRes.json();
      
      if (!metaData || !metaData.meta || !metaData.meta.name) return { streams: [] };
      const title = metaData.meta.name;

      const searchRes = await fetch(`https://phimapi.com/v1/api/tim-kiem?keyword=${encodeURIComponent(title)}&limit=1`);
      const searchData = await searchRes.json();

      if (searchData.data && searchData.data.items && searchData.data.items.length > 0) {
        slug = searchData.data.items[0].slug;
      } else {
        return { streams: [] }; 
      }
    } catch (e) {
      return { streams: [] };
    }
  } 
  // TRƯỜNG HỢP 2: Phim trực tiếp từ Catalog KKPhim
  else if (args.id.startsWith('kkphim_')) {
    const parts = args.id.split(':');
    slug = parts[0].replace('kkphim_', '');
    if (parts.length > 1) {
      targetEpisodeSlug = parts[1]; 
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
            const epNumber = epMatch ? epMatch[0] : '';
            isMatch = (epNumber == targetEpisode || ep.slug.endsWith(`tap-${targetEpisode}`) || ep.slug.endsWith(`tap-0${targetEpisode}`));
          } 
          else if (targetEpisodeSlug) {
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
