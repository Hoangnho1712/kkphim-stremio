const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const fetch = require('node-fetch');

const manifest = {
  id: 'org.kkphim.stremio.myaddon',
  version: '1.0.0',
  name: 'KKPhim Của Tôi',
  description: 'Xem phim KKPhim 24/7 cá nhân',
  resources: ['catalog', 'meta', 'stream'],
  types: ['movie', 'series'],
  catalogs: [{ type: 'movie', id: 'kkphim_latest', name: 'KKPhim - Mới Cập Nhật' }],
  idPrefixes: ['kkphim_']
};

const builder = new addonBuilder(manifest);

builder.defineCatalogHandler(async (args) => {
  if (args.type === 'movie' && args.id === 'kkphim_latest') {
    try {
      const res = await fetch('https://phimapi.com/danh-sach/phim-moi-cap-nhat?page=1');
      const data = await res.json();
      const metas = (data.items || []).map(m => ({
        id: `kkphim_${m.slug}`,
        type: 'movie',
        name: m.name,
        poster: m.poster_url,
        description: `Tên gốc: ${m.origin_name} (${m.year})`
      }));
      return { metas };
    } catch (e) { return { metas: [] }; }
  }
  return { metas: [] };
});

builder.defineMetaHandler(async (args) => {
  const slug = args.id.replace('kkphim_', '');
  try {
    const res = await fetch(`https://phimapi.com/phim/${slug}`);
    const data = await res.json();
    const movie = data.movie;
    return {
      meta: {
        id: args.id,
        type: 'movie',
        name: movie.name,
        poster: movie.poster_url,
        background: movie.thumb_url,
        description: movie.content ? movie.content.replace(/<[^>]*>/g, '') : '',
        year: parseInt(movie.year) || undefined,
        genres: movie.category ? movie.category.map(c => c.name) : []
      }
    };
  } catch (e) { return { meta: {} }; }
});

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
              title: `${server.server_name} - Tập ${ep.name}`,
              url: ep.link_m3u8
            });
          }
        });
      });
    }
    return { streams };
  } catch (e) { return { streams: [] }; }
});

const PORT = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: PORT });
