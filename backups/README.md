# Projenin tam arşivi

Çalışan site: https://baharercili.github.io/obje-kutuphanesi/

Bu arşiv Obje Kütüphanesi'ne aittir: Zara Home, H&M Home ve Hipicon görsel seçkisi. Diğer SOMASS projeleri ve tarayıcıdaki kişisel seçimler bu herkese açık depoya dahil edilmez.

- **Web uygulaması ve kataloglar:** deponun ana dizinindeki HTML, CSS, JavaScript ve JSON dosyaları.
- **Aktif 3D önizlemeler:** `models/` ve `model-assets.json`; 2.147 model. Orijinal malzemeler GLB dosyalarının içindedir.
- **Tam çözünürlüklü model arşivi:** dört model Release'inde 2.609 GLB, toplam 28.058.960.264 bayt. Uygulamadan çıkarılmış ev tekstili modellerinin arşiv kopyaları da korunur. Dosya adları, indirme bağlantıları, boyutları ve SHA-256 özetleri `full-model-archive.json` içindedir.
- **Model üretim kaynakları:** `source-recipes.zip` içinde 937 kaynak dosyası. Eski çalışma bilgisayarına ait kullanıcı dizini adı genelleştirilmiştir. Bu kaynaklar tarihsel geliştirme kayıtlarıdır; tekrar model üretmek için ilgili kaynak görsellerini ve kullanılan Blender/Python ortamını kurmak gerekir.
- **Orijinal referans fotoğrafları:** [tam proje yedeği Release'i](https://github.com/baharercili/obje-kutuphanesi/releases/tag/project-backup-2026-11-27) içindeki `reference-images-*.zip` arşivleri. Aynı fotoğrafın farklı boyut bağlantıları tek görüntü kaydında birleştirilir. Dosyalara görüntü düzenlemesi yapılmaz.
- **Sabitlenmiş görüntüleyici bağımlılıkları ve yazı tipleri:** aynı Release içindeki `runtime-dependencies-*.zip`; özgün npm paketleri lisans dosyalarıyla birlikte korunur.

Fotoğraf yedeği tamamlandığında `complete-project-manifest.json` ana dizine değil bu `backups/` klasörüne kaydedilir. Manifestte `status: complete`, arşivlenmiş görüntü sayısı, kaynak URL eşlemeleri ve her ZIP/görüntünün SHA-256 özeti bulunur. Bir kaynak görsel artık sunulmuyorsa manifest `partial` olur ve erişilemeyen URL'ler açıkça listelenir. Manifestin bir kopyası Release'e de yüklenir.

Canlı site orijinal marka fotoğraf bağlantılarını kullanmaya devam eder. ZIP yedekleri bu bağlantılardan bağımsız bir geri yükleme kopyasıdır. Site, GitHub Pages üzerinde çalışır; Mac'te yerel sunucu veya model kopyası gerektirmez.

## Geri yükleme

1. Web uygulaması dosyalarını ve `models/` önizlemelerini bu depodan alın.
2. Tam modeller gerekiyorsa `full-model-archive.json` içindeki Release bağlantılarını kullanın; indirmeleri kaydedilen boyut ve SHA-256 özetleriyle doğrulayın.
3. Referans fotoğrafları için Release'teki bütün `reference-images-*.zip` parçalarını aynı klasöre açın. Manifestteki `original_urls` kaynak bağlantıları, `filename` ise arşivdeki dosyadır.
4. Üretim kaynakları gerekiyorsa `source-recipes.zip` dosyasını ayrıca açın.

Orijinal ürün görselleri ve marka adları ilgili sahiplerine aittir. Bu arşiv yeni bir kullanım lisansı vermez.
