# Changelog

## [1.2.0](https://github.com/iamjava-com/apione-studio/compare/v1.1.0...v1.2.0) (2026-09-07)


### Features

* dialogs, menus and the command palette arrive instead of popping ([#24](https://github.com/iamjava-com/apione-studio/issues/24)) ([31cdb39](https://github.com/iamjava-com/apione-studio/commit/31cdb394416d5e501c2834291d28e2a8ef2e0f29))
* every wait shows itself on the control that started it ([#19](https://github.com/iamjava-com/apione-studio/issues/19)) ([d1098d0](https://github.com/iamjava-com/apione-studio/commit/d1098d01914fd84d62704af4801697df4efed7d5))


### Bug Fixes

* a never-saved project's Mock tab asks for a save, not for patience ([#23](https://github.com/iamjava-com/apione-studio/issues/23)) ([37f1a8b](https://github.com/iamjava-com/apione-studio/commit/37f1a8b3e1b21bb70153c4b5f446187e0a035f0a))
* a second drag between groups no longer undoes the first on screen ([#28](https://github.com/iamjava-com/apione-studio/issues/28)) ([b02b13e](https://github.com/iamjava-com/apione-studio/commit/b02b13e69777983214f210ad8be6425b3f2dd8b7))
* a view whose code fails to load says so instead of blaming the document ([#22](https://github.com/iamjava-com/apione-studio/issues/22)) ([7a39069](https://github.com/iamjava-com/apione-studio/commit/7a390699bfdf09b471e3c61a29609b2f26e472fe))
* the breaking-changes list closes on a click elsewhere, like every popup ([#29](https://github.com/iamjava-com/apione-studio/issues/29)) ([0cd5a16](https://github.com/iamjava-com/apione-studio/commit/0cd5a16f89984822eb26c60d2d6bb74b3adeba50))

## [1.1.0](https://github.com/iamjava-com/apione-studio/compare/v1.0.4...v1.1.0) (2026-08-31)


### Features

* a diff of just the endpoint behind each history row ([#8](https://github.com/iamjava-com/apione-studio/issues/8)) ([1d2f7b6](https://github.com/iamjava-com/apione-studio/commit/1d2f7b634bfe1f5ee3e46feeecb86c68ef7f65ff))
* changelog between two versions of the spec ([#5](https://github.com/iamjava-com/apione-studio/issues/5)) ([12c0a25](https://github.com/iamjava-com/apione-studio/commit/12c0a2510ad5c15b019194a495ce95d7297c2d86))
* history lists what changed per endpoint ([#6](https://github.com/iamjava-com/apione-studio/issues/6)) ([86b2efd](https://github.com/iamjava-com/apione-studio/commit/86b2efd6498ef021d03ccc9370f10b0c5c76a65e))
* history rows show the endpoint summary and whether it breaks ([#15](https://github.com/iamjava-com/apione-studio/issues/15)) ([47cd607](https://github.com/iamjava-com/apione-studio/commit/47cd607e963c727a5bd3caa2a063d16b1523faf3))


### Bug Fixes

* form typing and outline drags stutter on large specs ([#4](https://github.com/iamjava-com/apione-studio/issues/4)) ([f57a6cb](https://github.com/iamjava-com/apione-studio/commit/f57a6cb3f8740e817e966692f9b01ef8500ead30))
* switching to the YAML view blanks the pane ([#14](https://github.com/iamjava-com/apione-studio/issues/14)) ([9f252b8](https://github.com/iamjava-com/apione-studio/commit/9f252b871c2265293026f4df18f6ff664b41d206))
* the outline blanks for a moment when switching to the YAML view ([#10](https://github.com/iamjava-com/apione-studio/issues/10)) ([c5d4bd1](https://github.com/iamjava-com/apione-studio/commit/c5d4bd13a1287b389bbf5f5726d48bf15e3e44aa))

## [1.0.4](https://github.com/iamjava-com/apione-studio/compare/v1.0.3...v1.0.4) (2026-08-28)


### Bug Fixes

* history freezes the tab when diffing two large, differently ordered versions ([b6bdd56](https://github.com/iamjava-com/apione-studio/commit/b6bdd5635b0a4fcfed55f5b1ed26d9a09ecf015a))
* opening the history panel collapses the outline ([7f7d1b9](https://github.com/iamjava-com/apione-studio/commit/7f7d1b9b49ddc6cbdc4846747d0a09bdcc7a4ca0))

## [1.0.3](https://github.com/iamjava-com/apione-studio/compare/v1.0.2...v1.0.3) (2026-08-26)


### Bug Fixes

* history panel freezes on large specs ([2a94f0b](https://github.com/iamjava-com/apione-studio/commit/2a94f0be8d5d3f869b6d528b6688ff5f5c1ab66b))
* YAML view loses keystrokes and stutters on large specs ([5fed216](https://github.com/iamjava-com/apione-studio/commit/5fed21693baa66f9087d61777707cbbf8454ff74))
