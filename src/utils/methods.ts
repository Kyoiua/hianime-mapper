import { client } from "./client";
import { ANILIST_BASEURL, ANIME_QUERY, HIANIME_BASEURL } from "./constant";
import { load } from "cheerio";
import match from "string-similarity-js";
import { Megacloud } from "../extractors/megacloud";

/* ─────────────────────────────────────────────
   FETCH ANILIST + EPISODES
────────────────────────────────────────────── */
export const fetchAnilistInfo = async (id: number) => {
  try {
    const resp = await client.post<any, { data: { data: AnilistAnime } }>(
      ANILIST_BASEURL,
      {
        query: ANIME_QUERY,
        variables: { id },
      }
    );

    const data = resp.data.data.Media;

    const eps = await searchNScrapeEPs(data.title);

    return {
      ...data,

      // normalize all optional arrays safely
      recommendations: data.recommendations?.edges
        ? data.recommendations.edges.map(
            (el) => el.node.mediaRecommendation
          )
        : [],

      relations: data.relations?.edges
        ? data.relations.edges.map((el) => ({
            id: el.id,
            ...el.node,
          }))
        : [],

      characters: data.characters?.edges
        ? data.characters.edges.map((el) => ({
            role: el.role,
            ...el.node,
            voiceActors: el.voiceActors,
          }))
        : [],

      // ✅ IMPORTANT FIX: always array
      episodes: Array.isArray(eps) ? eps : [],
    };
  } catch (err) {
    console.error(err);
    return null;
  }
};

/* ─────────────────────────────────────────────
   SEARCH + SCRAPE EPISODES
────────────────────────────────────────────── */
export const searchNScrapeEPs = async (searchTitle: Title) => {
  try {
    const resp = await client.get(
      `${HIANIME_BASEURL}/search?keyword=${searchTitle.english}`
    );

    if (!resp) return [];

    const $ = load(resp.data);

    let similarTitles: {
      id: string;
      title: string;
      similarity: number;
    }[] = [];

    $(".film_list-wrap > .flw-item .film-detail .film-name a")
      .each((i, el) => {
        const title = $(el).text();
        const id =
          $(el).attr("href")!.split("/").pop()?.split("?")[0] ?? "";

        const similarity = Number(
          (
            match(
              title.replace(/[\,\:]/g, ""),
              searchTitle.english || searchTitle.native
            ) * 10
          ).toFixed(2)
        );

        similarTitles.push({ id, title, similarity });
      });

    similarTitles.sort((a, b) => b.similarity - a.similarity);

    const pick =
      (searchTitle.english.match(/\Season(.+?)\d/) &&
        similarTitles[0]?.title?.match(/\Season(.+?)\d/)) ||
      (!searchTitle.english.match(/\Season(.+?)\d/) &&
        !similarTitles[0]?.title?.match(/\Season(.+?)\d/))
        ? similarTitles[0]
        : similarTitles[1];

    if (!pick?.id) return [];

    const eps = await getEpisodes(pick.id);
    return Array.isArray(eps) ? eps : [];
  } catch (err) {
    console.error(err);
    return [];
  }
};

/* ─────────────────────────────────────────────
   GET EPISODES
────────────────────────────────────────────── */
export const getEpisodes = async (animeId: string) => {
  try {
    const resp = await client.get(
      `${HIANIME_BASEURL}/ajax/v2/episode/list/${animeId
        .split("-")
        .pop()}`,
      {
        headers: {
          referer: `${HIANIME_BASEURL}/watch/${animeId}`,
          "X-Requested-With": "XMLHttpRequest",
        },
      }
    );

    const $ = load(resp.data.html);

    let episodesList: {
      id: string;
      episodeId: number;
      title: string;
      number: number;
    }[] = [];

    $("#detail-ss-list div.ss-list a").each((i, el) => {
      episodesList.push({
        id: $(el).attr("href")?.split("/").pop() ?? "",
        episodeId: Number(
          $(el).attr("href")?.split("?ep=").pop()
        ),
        title: $(el).attr("title") ?? "",
        number: i + 1,
      });
    });

    return episodesList;
  } catch (err) {
    console.error(err);
    return []; // ✅ NEVER return object/null
  }
};

/* ─────────────────────────────────────────────
   SERVERS
────────────────────────────────────────────── */
export const getServers = async (epId: string) => {
  try {
    const resp = await client(
      `${HIANIME_BASEURL}/ajax/v2/episode/servers?episodeId=${epId}`,
      {
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          referer: `${HIANIME_BASEURL}/watch/${epId}`,
        },
      }
    );

    const $ = load(resp.data.html);

    let servers = {
      sub: [],
      dub: [],
    };

    $(".server-item").each((i, el) => {
      const $parent = $(el).closest(".servers-sub, .servers-dub");
      const type = $parent.hasClass("servers-sub") ? "sub" : "dub";

      servers[type].push({
        serverId: $(el).attr("data-id") ?? null,
        serverName: $(el).text().replace(/\n/g, "").trim(),
      });
    });

    return servers;
  } catch (err) {
    console.error(err);
    return { sub: [], dub: [] };
  }
};

/* ─────────────────────────────────────────────
   SOURCES
────────────────────────────────────────────── */
export const getSources = async (serverId: string, epId: string) => {
  try {
    const res = await client(
      `${HIANIME_BASEURL}/ajax/v2/episode/sources?id=${serverId}`,
      {
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          referer: `${HIANIME_BASEURL}/watch/${epId}`,
        },
      }
    );

    const link = res.data.link;
    if (!link) return { sources: null };

    if (String(link).includes("megacloud")) {
      return await new Megacloud(link).scrapeMegaCloud();
    }

    return { sources: null };
  } catch (err) {
    console.error(err);
    return { sources: null };
  }
};
