(function() {
    'use strict';

    // Конфигурация API-источников
    const sources = {
        kodik: {
            name: "Kodik",
            url: "https://kodikapi.com/search?token=YOUR_TOKEN&kinopoisk_id={kp_id}&quality=4k",
            quality: ["4k", "1080p", "720p"]
        },
        videocdn: {
            name: "VideoCDN",
            url: "https://videocdn.tv/api/short?api_token=YOUR_TOKEN&kinopoisk_id={kp_id}&quality=2160p",
            quality: ["2160p", "1080p"]
        },
        zetflix: {
            name: "Zetflix",
            url: "https://api.zetflix-internal.workers.dev/movies/{kp_id}?quality=ultrahd",
            quality: ["ultrahd", "fullhd"]
        }
    };

    // Генерация уникального ID пользователя
    let userId = Lampa.Storage.get('lampa_user_id', '');
    if (!userId) {
        userId = Lampa.Utils.uid(12);
        Lampa.Storage.set('lampa_user_id', userId);
    }

    // Добавление кнопки "Смотреть онлайн" в интерфейс Lampa
    function addOnlineButton() {
        Lampa.Listener.follow('full', (e) => {
            if (e.type === 'complite' && e.object.activity) {
                const buttonHtml = `
                    <div class="full-start__button selector view--online_custom" data-subtitle="4K Online">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M10 16.5l6-4.5-6-4.5v9zM12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/>
                        </svg>
                        <span>Смотреть онлайн (4K)</span>
                    </div>
                `;

                const button = $(buttonHtml);
                button.on('hover:enter', () => {
                    launchOnlinePlayer(e.data.movie);
                });

                if (Lampa.Storage.get('card_interface_type') === 'new') {
                    e.object.activity.render().find('.button--play').before(button);
                } else {
                    e.object.activity.render().find('.view--torrent').before(button);
                }
            }
        });
    }

    // Запуск онлайн-плеера с выбором источника
    function launchOnlinePlayer(movie) {
        const kpId = movie.kinopoisk_id || movie.imdb_id;
        if (!kpId) {
            Lampa.Noty.show('Ошибка: Нет ID фильма (Kinopoisk/IMDb)');
            return;
        }

        // Запрос к API источников
        const requests = Object.keys(sources).map(source => {
            const apiUrl = sources[source].url.replace('{kp_id}', kpId);
            return Lampa.Utils.fetch(apiUrl)
                .then(res => res.json())
                .then(data => ({
                    source: sources[source].name,
                    quality: data.quality || 'unknown',
                    links: data.links || []
                }))
                .catch(() => null);
        });

        // Обработка результатов
        Promise.all(requests).then(results => {
            const availableSources = results.filter(Boolean);
            if (availableSources.length === 0) {
                Lampa.Noty.show('Нет доступных источников в 4K');
                return;
            }

            // Создание модального окна с выбором источника
            const modalHtml = `
                <div class="online-sources-modal">
                    <div class="modal__title">Выберите источник (4K)</div>
                    <div class="modal__content">
                        ${availableSources.map(src => `
                            <div class="source-selector selector" data-source="${src.source}">
                                <span>${src.source}</span>
                                <small>Качество: ${src.quality}</small>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;

            const modal = $(modalHtml);
            modal.find('.source-selector').on('hover:enter', function() {
                const sourceName = $(this).data('source');
                const sourceData = availableSources.find(s => s.source === sourceName);
                playMovie(sourceData.links[0]); // Берём первую ссылку (можно добавить выбор качества)
            });

            Lampa.Modal.open({
                title: '4K Online',
                html: modal,
                onBack: () => Lampa.Modal.close()
            });
        });
    }

    // Воспроизведение видео
    function playMovie(videoUrl) {
        Lampa.Player.play({
            url: videoUrl,
            title: 'Онлайн (4K)',
            quality: '2160p',
            isonline: true
        });
    }

    // Инициализация плагина
    if (!window.lampa_custom_online) {
        window.lampa_custom_online = true;
        addOnlineButton();
    }
})();
