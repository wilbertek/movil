import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  Pressable,
  StyleSheet,
  FlatList,
  Image,
  ActivityIndicator,
  Platform,
} from "react-native";
import Slider from "@react-native-community/slider";
import { Audio } from "expo-av";
import * as DocumentPicker from "expo-document-picker";

// --- LÓGICA DE IMAGEN: Importación de compatibilidad (Legacy) para Expo 54+ ---
import * as FileSystem from "expo-file-system/legacy"; 
import jsmediatags from "jsmediatags/dist/jsmediatags.min.js";
import { Buffer } from "buffer";

// --- LÓGICA DE IMAGEN: Configuración global de Buffer para procesar binarios ---
// @ts-ignore
global.Buffer = global.Buffer || Buffer;

// --- LÓGICA DE IMAGEN: Parche para que jsmediatags no falle en Android ---
if (!global.XMLHttpRequest.prototype.overrideMimeType) {
  global.XMLHttpRequest.prototype.overrideMimeType = () => {};
}

import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
} from "lucide-react-native";

type Track = {
  id: string;
  title: string;
  uri: string;
  artwork?: string; // --- LÓGICA DE IMAGEN: Guardará la cadena Base64 de la portada ---
};

function formatTime(ms: number) {
  if (!ms || ms < 0) return "0:00";
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function App() {
  const soundRef = useRef<Audio.Sound | null>(null);

  const [playlist, setPlaylist] = useState<Track[]>([]);
  const [index, setIndex] = useState(0);
  const track = useMemo(() => playlist[index], [playlist, index]);

  const [isLoaded, setIsLoaded] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);

  const [isSeeking, setIsSeeking] = useState(false);
  const [seekValue, setSeekValue] = useState(0);
  const [isLoadingLibrary, setIsLoadingLibrary] = useState(false);

  async function unloadCurrent() {
    if (soundRef.current) {
      try {
        await soundRef.current.unloadAsync();
      } catch {}
      soundRef.current = null;
    }
    setIsLoaded(false);
    setIsPlaying(false);
    setPosition(0);
    setDuration(0);
  }

  function handlePrev() {
    if (!playlist.length) return;
    setIndex((prev) => (prev - 1 + playlist.length) % playlist.length);
  }

  function handleNext() {
    if (!playlist.length) return;
    setIndex((prev) => (prev + 1) % playlist.length);
  }

  async function loadTrack(autoPlay = true) {
    if (!track) return;
    await unloadCurrent();
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
    });

    try {
      const { sound, status } = await Audio.Sound.createAsync(
        { uri: track.uri },
        { shouldPlay: autoPlay },
        (s) => {
          if (!s.isLoaded) return;
          setIsLoaded(true);
          setIsPlaying(s.isPlaying);
          setPosition(s.positionMillis ?? 0);
          setDuration(s.durationMillis ?? 0);
          if (s.didJustFinish) handleNext();
        }
      );
      soundRef.current = sound;
    } catch (e) {
      console.log("Error cargando track:", e);
    }
  }

  useEffect(() => {
    if (!track) return;
    loadTrack(true);
    return () => { unloadCurrent(); };
  }, [index, track?.uri]);

  async function togglePlay() {
    if (!soundRef.current) return;
    const status = await soundRef.current.getStatusAsync();
    if (!status.isLoaded) return;
    if (status.isPlaying) await soundRef.current.pauseAsync();
    else await soundRef.current.playAsync();
  }

  async function seekTo(ms: number) {
    if (!soundRef.current) return;
    await soundRef.current.setPositionAsync(ms);
  }

  async function loadDeviceAudios() {
    if (Platform.OS === "web") return alert("No disponible en Web");

    setIsLoadingLibrary(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "audio/*",
        multiple: true,
        copyToCacheDirectory: true,
      });

      if (result.canceled) return;

      // --- LÓGICA DE IMAGEN: Procesamiento con la API Legacy para evitar errores de esquema ---
      const tracksWithMetadata: Track[] = await Promise.all(
        result.assets.map(async (file) => {
          return new Promise<Track>(async (resolve) => {
            try {
              // 1. Leemos el archivo usando el import legacy y 'base64' como texto directo
              const base64Data = await FileSystem.readAsStringAsync(file.uri, {
                encoding: "base64", 
              });

              // 2. Convertimos a Buffer para que jsmediatags lo procese en memoria
              const buffer = Buffer.from(base64Data, "base64");

              new jsmediatags.Reader(buffer).read({
                onSuccess: (tag) => {
                  const { title, picture } = tag.tags;
                  let artworkUri = undefined;

                  // 3. Extraemos la imagen si existe
                  if (picture) {
                    const b64 = Buffer.from(picture.data).toString("base64");
                    artworkUri = `data:${picture.format};base64,${b64}`;
                  }

                  resolve({
                    id: file.uri,
                    title: title || file.name || "Sin título",
                    uri: file.uri,
                    artwork: artworkUri,
                  });
                },
                onError: (error) => {
                  console.log("Error en metadatos:", error);
                  resolve({ id: file.uri, title: file.name, uri: file.uri });
                },
              });
            } catch (err) {
              console.log("Error de lectura:", err);
              resolve({ id: file.uri, title: file.name, uri: file.uri });
            }
          });
        })
      );

      setPlaylist(tracksWithMetadata);
      setIndex(0);
    } catch (e) {
      console.log("Error:", e);
    } finally {
      setIsLoadingLibrary(false);
    }
  }

  const sliderValue = isSeeking ? seekValue : position;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.h1}>⋆REG-PRODUCTOR⋆</Text>

        <Pressable
          style={[styles.loadBtn, isLoadingLibrary && { opacity: 0.7 }]}
          onPress={loadDeviceAudios}
          disabled={isLoadingLibrary}
        >
          {isLoadingLibrary ? (
            <ActivityIndicator color="#57c2c0" />
          ) : (
            <Text style={styles.loadBtnText}>♫ Agregar música ♫</Text>
          )}
        </Pressable>

        <View style={styles.card}>
          {track ? (
            <>
              <View style={styles.trackRow}>
                {/* --- LÓGICA DE IMAGEN: Renderizado dinámico de la portada --- */}
                <Image
                  source={
                    track.artwork
                      ? { uri: track.artwork }
                      : require("./assets/icon.png")
                  }
                  style={styles.cover}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.title} numberOfLines={1}>{track.title}</Text>
                  <Text style={styles.artist} numberOfLines={1}>
                    {duration ? `Duración: ${formatTime(duration)}` : ""}
                  </Text>
                </View>
              </View>

              <View style={styles.progressRow}>
                <Text style={styles.time}>{formatTime(sliderValue)}</Text>
                <Text style={styles.time}>{formatTime(duration)}</Text>
              </View>

              <Slider
                style={{ width: "100%", height: 50 }}
                minimumValue={0}
                maximumValue={duration || 1}
                value={sliderValue}
                disabled={!isLoaded}
                onSlidingStart={() => setIsSeeking(true)}
                onValueChange={(v) => setSeekValue(v)}
                onSlidingComplete={async (v) => {
                  setIsSeeking(false);
                  await seekTo(v);
                }}
                minimumTrackTintColor="#0d6971"
                maximumTrackTintColor="#cbe5f8"
                thumbTintColor="#004e5c"
              />

              <View style={styles.controls}>
                <Pressable style={styles.btn} onPress={handlePrev}>
                  <SkipBack color="white" size={24} />
                </Pressable>

                <Pressable style={[styles.btn, styles.btnPrimary]} onPress={togglePlay}>
                  <Text style={styles.btnPrimaryText}>{isPlaying ? "⏸" : "▶"}</Text>
                </Pressable>

                <Pressable style={styles.btn} onPress={handleNext}>
                  <SkipForward color="white" size={24} />
                </Pressable>
              </View>
            </>
          ) : (
            <Text style={{ color: "#ffffff", textAlign: 'center' }}>⋆ Selecciona música ⋆</Text>
          )}
        </View>

        <FlatList
          data={playlist}
          keyExtractor={(item) => item.id}
          style={{ marginTop: 20 }}
          renderItem={({ item, index: i }) => (
            <Pressable
              onPress={() => setIndex(i)}
              style={[styles.itemRow, i === index ? styles.itemRowActive : null]}
            >
              {/* --- LÓGICA DE IMAGEN: Portada miniatura en la lista --- */}
              <Image 
                source={item.artwork ? { uri: item.artwork } : require("./assets/icon.png")} 
                style={styles.itemCover} 
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.itemTitle} numberOfLines={1}>{item.title}</Text>
              </View>
            </Pressable>
          )}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#333333" },
  container: { flex: 1, padding: 16 },
  h1: { fontSize: 40, fontWeight: "700", marginBottom: 20, color: "#ffffff", textAlign: "center" },
  loadBtn: { paddingVertical: 12, borderRadius: 12, backgroundColor: "#ca4f9f", marginBottom: 12, alignItems: "center" },
  loadBtnText: { color: "#ffffff", fontWeight: "800" },
  card: { borderRadius: 16, padding: 16, backgroundColor: "#4ba3aec6" },
  trackRow: { flexDirection: "row", gap: 12, alignItems: "center" },
  cover: { width: 80, height: 80, borderRadius: 12, backgroundColor: '#000' },
  title: { fontSize: 18, fontWeight: "700", color: '#fff' },
  artist: { fontSize: 13, color: "#004450" },
  progressRow: { marginTop: 12, flexDirection: "row", justifyContent: "space-between" },
  time: { fontSize: 12, color: "#000" },
  controls: { marginTop: 14, flexDirection: "row", justifyContent: "center", gap: 20, alignItems: "center" },
  btn: { padding: 10, borderRadius: 50, backgroundColor: "#005562" },
  btnPrimary: { backgroundColor: "#003e47", paddingHorizontal: 25 },
  btnPrimaryText: { color: "#fff", fontSize: 24 },
  itemRow: { padding: 10, flexDirection: "row", gap: 10, alignItems: "center" },
  itemRowActive: { backgroundColor: "#9c5b83", borderRadius: 10 },
  itemCover: { width: 40, height: 40, borderRadius: 5 },
  itemTitle: { fontWeight: "700", color: "#ffffff" },
});