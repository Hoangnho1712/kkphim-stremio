const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const fetch = require('node-fetch');

const manifest = {
  id: 'org.kkphim.stremio.myaddon',
  version: '2.1.0',
  name: 'KKPhim Của Tôi',
  description: 'Kho phim KKPhim đầy đủ - Cuộn trang không giới hạn',
  resources: ['catalog', 'meta', 'stream'],
  types: ['movie', 'series'],
  catalogs: [
    {
      type: 'movie',
      id: 'kk_phim_le',
      name: 'KKPhim - Phim Lẻ',
      extra: [
        { name: 'search', isRequired: false },
        { name: 'skip', isRequired: false }
      ]
    },
    {
      type: 'series',
      id: 'kk_phim_bo',
      name: 'KKPhim - Phim Bộ',
      extra: [
        { name: 'search', isRequired: false },
        { name: 'skip', isRequired: false }
      ]
    },
    {
      type: 'series',
      id: 'kk_hoat_hinh',
      name: 'KKPhim - Hoạt Hình',
      extra: [
        { name: 'search', isRequired: false },
        { name: 'skip', isRequired: false }
      ]
    },
    {
      type: 'series',
      id: 'kk_tv_shows',
      name: 'KKPhim - TV Shows',
      extra: [
        { name: 'search', isRequired: false },
        { name: 'skip', isRequired: false }
      ]
    }
  ],
  idPrefixes: ['kkphim_']
};

const builder = new addonBuilder(manifest);

// 1. Xử lý danh sách phim + Phân trang (Cuộn xem thêm)
builder.defineCatalogHandler(async (args) => {
  let url = '';
  // Tính toán số trang dựa trên số lượng phim đã bỏ qua (skip)
  const skip = (args.extra && args.extra.skip) ? parseInt(args.extra.skip) : 0;
  const limit = 24;
  const page = Math.floor(skip / limit) + 1;

  // Nếu người dùng gõ Tìm kiếm
  if (args.extra && args.extra.search) {
    const keyword = encodeURIComponent(args.extra.search);
    url = `https://phimapi.com/v1/api/tim-kiem?keyword=${keyword}&limit=${limit}&page=${page}`;
  } else {
    // Phân loại danh mục
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
    console.error('Catalog Error:', e);
    return { metas: [] };
  }
});

// 2. Chi tiết phim
builder.defineMetaHandler(async (args) => {
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

// 3. Link xem phim (Stream m3u8)
builder.defineStreamHandler(async (args) => {
  const slug = args.id.replace('kkphim_', '');
  try {
    const res = await fetch(`https://phimapi.com/phim/${slug}`);
    const data = await res.json();
    const streams = [];

    if (data.episodes) {
      data.episodes.forEach(server => {
        server.server_data.forEach(ep => {
          if (ep.link_m3u8) {
            streams.push({
              title: `${server.server_name} - ${ep.name}`,
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

const PORT = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: PORT });
