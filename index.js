const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');

const manifest = {
  id: 'org.kkphim.stremio.myaddon',
  version: '3.1.4',
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

// 3. Stream Handler (Đã vá lỗi Season thông minh)
builder.defineStreamHandler(async (args) => {
  let slug = '';
  let targetSeason = null;
  let targetEpisode = null;      
  let targetEpisodeSlug = null;  

  if (args.id.startsWith('tt') || args.id.startsWith('tmdb:')) {
    try {
      const parts = args.id.split(':');
      let metaId = '';
      
      if (args.id.startsWith('tt')) {
        metaId = parts[0]; 
        if (parts.length > 2) {
          targetSeason = parseInt(parts[1]); // Lấy Mùa (Season)
          targetEpisode = parseInt(parts[2]); // Lấy Tập
        }
      } 
      else if (args.id.startsWith('tmdb:')) {
        metaId = `${parts[0]}:${parts[1]}`; 
        if (parts.length > 3) {
          targetSeason = parseInt(parts[2]); // Lấy Mùa (Season)
          targetEpisode = parseInt(parts[3]); // Lấy Tập
        }
      }

      const metaRes = await fetch(`https://v3-cinemeta.strem.io/meta/${args.type}/${metaId}.json`);
      const metaData = await metaRes.json();
      
      if (!metaData || !metaData.meta || !metaData.meta.name) return { streams: [] };
      const title = metaData.meta.name;

      // Tìm kiếm trên API với limit lớn hơn để lấy đủ các Season
      const searchRes = await fetch(`https://phimapi.com/v1/api/tim-kiem?keyword=${encodeURIComponent(title)}&limit=24`);
      const searchData = await searchRes.json();

      if (searchData.data && searchData.data.items && searchData.data.items.length > 0) {
        const items = searchData.data.items;
        let matchedItem = items[0]; // Mặc định là phần 1 (kết quả đầu)

        // THUẬT TOÁN TÌM ĐÚNG SEASON NẾU CÓ TRÊN KKPHIM
        if (targetSeason && targetSeason > 1) {
          const sRegex1 = new RegExp(`phần ${targetSeason}`, 'i');
          const sRegex2 = new RegExp(`season ${targetSeason}`, 'i');
          const sRegex3 = new RegExp(`phần 0${targetSeason}`, 'i');

          const foundMatch = items.find(item => {
            const name = item.name || '';
            const origin = item.origin_name || '';
            return sRegex1.test(name) || sRegex2.test(name) || sRegex3.test(name) ||
                   sRegex1.test(origin) || sRegex2.test(origin) || sRegex3.test(origin);
          });

          if (foundMatch) {
            matchedItem = foundMatch; // Thay thế bằng đúng Season tìm được
          }
        }
        
        slug = matchedItem.slug;
      } else {
        return { streams: [] }; 
      }
    } catch (e) {
      return { streams: [] };
    }
  } 
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

          // Lọc chính xác tập phim (So sánh giá trị số)
          if (targetEpisode) {
            const epMatch = ep.name.match(/\d+/); 
            const epNumber = epMatch ? parseInt(epMatch[0]) : null;
            
            isMatch = (epNumber === targetEpisode || 
                       ep.slug === `tap-${targetEpisode}` || 
                       ep.slug === `tap-0${targetEpisode}`);
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
