# Cherry laurel leaf plate

`leaf.webp` is a cropped and background-isolated derivative of
[`Kirschlorbeer-blatt.jpeg`](https://commons.wikimedia.org/wiki/File:Kirschlorbeer-blatt.jpeg),
photographed by Daniel Herndler on 23 February 2019. The source identifies the
subject as cherry laurel, _Prunus laurocerasus_ 'Caucasica'.

The source photograph and this derivative are licensed under the
[Creative Commons Attribution-ShareAlike 3.0 Unported license](https://creativecommons.org/licenses/by-sa/3.0/).

Changes made for this project: the photographed leaf blade was cropped from
the neutral background, the petiole was removed, the blade was alpha-matted
and rotated to the library's blade-up UV convention, and the dark winter
exposure was modestly brightened to match the medium-green cultivar references.
The photograph's harsh upper highlights were also compressed so its baked
lighting would not compound the runtime material's specular response. The
result was resized to a 1024 x 1024 transparent plate and lossy WebP-compressed.
No leaf pixels were procedurally painted or synthesized.

The reproducible extraction and compression pipeline is
`scripts/make-cherrylaurel-leaf-texture.mjs`. It pins the downloaded source by
SHA-256 before processing it.
