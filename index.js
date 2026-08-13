const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const fetch = require('node-fetch');

const manifest = {
  id: 'org.kkphim.stremio.myaddon',
  version: '3.1.1',
  name: 'KKPhim Của Tôi',
  description: 'Tích hợp KKPhim vào Cinemeta / TMDB (Phim Lẻ & Phim Bộ)',
  resources: ['catalog', 'meta', 'stream'],
  types: ['movie', 'series'],
  idPrefixes: ['tt', 'kkphim_'],
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

// 1. Catalog Handler (Hiện đủ 4 danh mục & cuộn vô tận)
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

// 2. Meta Handler
builder.defineMetaHandler(async (args) => {
  if (!args.id.startsWith('kkphim_')) return { meta: {} };
  
  const slug = args.id.replace('kkphim_', '');
  try {
    const res = await fetch(`https://phimapi.com/phim/${slug}`);
    const data = await res.json();
    const movie = data.movie;

    return {
      meta: {
        id: args.id,
        type: movie.type === 'single' ? 'movie' : 'series',
        name: movie.name,
        poster: movie.poster_url,
        background: movie.thumb_url,
        description: movie.content ? movie.content.replace(/<[^>]*>/g, '') : '',
        year: parseInt(movie.year) || undefined,
        genres: movie.category ? movie.category.map(c => c.name) : []
      }
    };
  } catch (e) {
    return { meta: {} };
  }
});

// 3. Stream Handler (Khớp link Phim Lẻ + Phim Bộ IMDb)
builder.defineStreamHandler(async (args) => {
  let slug = '';
  let targetEpisode = null;

  if (args.id.startsWith('tt')) {
    try {
      const parts = args.id.split(':');
      const imdbId = parts[0];
      if (parts.length > 2) {
        targetEpisode = parts[2];
      }

      const metaRes = await fetch(`https://v3-cinemeta.strem.io/meta/${args.type}/${imdbId}.json`);
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
  } else if (args.id.startsWith('kkphim_')) {
    slug = args.id.replace('kkphim_', '');
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
            const epNumber = ep.name.replace(/\D/g, '');
            isMatch = (epNumber == targetEpisode || ep.slug.endsWith(`tap-${targetEpisode}`));
          }

          if (isMatch && ep.link_m3u8) {
            streams.push({
              title: `[KKPhim] ${server.server_name} - ${ep.name}`,
              url: ep.link_m3u8
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

// Chỉnh lại phần Port chuẩn cho Render
const PORT = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: PORT, host: '0.0.0.0' });
