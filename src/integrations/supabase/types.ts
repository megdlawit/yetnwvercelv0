export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      custom_layers: {
        Row: {
          created_at: string
          data: Json
          id: string
          institution_id: string | null
          layer_key: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          data: Json
          id?: string
          institution_id?: string | null
          layer_key: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          data?: Json
          id?: string
          institution_id?: string | null
          layer_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "custom_layers_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
        ]
      }
      institution_members: {
        Row: {
          created_at: string
          institution_id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          institution_id: string
          role?: string
          user_id: string
        }
        Update: {
          created_at?: string
          institution_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "institution_members_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
        ]
      }
      institutions: {
        Row: {
          logo_url: string | null
          description: string | null
          created_at: string
          id: string
          kind: string
          name: string
          owner_id: string | null
          slug: string | null
          updated_at: string
        }
        Insert: {
          logo_url?: string | null
          description?: string | null
          created_at?: string
          id?: string
          kind?: string
          name: string
          owner_id?: string | null
          slug?: string | null
          updated_at?: string
        }
        Update: {
          logo_url?: string | null
          description?: string | null
          created_at?: string
          id?: string
          kind?: string
          name?: string
          owner_id?: string | null
          slug?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      map_features: {
        Row: {
          building_id: string
          created_at: string
          depth: number | null
          floor_id: string
          id: string
          kind: string
          label: string | null
          rotation_deg: number
          source: string
          updated_at: string
          width: number | null
          x: number
          y: number
          wall_id: string | null
          offset_m: number | null
          height_m: number | null
          sill_m: number | null
          from_floor_id: string | null
          to_floor_id: string | null
          step_count: number | null
          landing: string | null
          accessible: boolean | null
          label_am: string | null
        }
        Insert: {
          building_id: string
          created_at?: string
          depth?: number | null
          floor_id: string
          id?: string
          kind: string
          label?: string | null
          rotation_deg?: number
          source?: string
          updated_at?: string
          width?: number | null
          x: number
          y: number
          wall_id?: string | null
          offset_m?: number | null
          height_m?: number | null
          sill_m?: number | null
          from_floor_id?: string | null
          to_floor_id?: string | null
          step_count?: number | null
          landing?: string | null
          accessible?: boolean | null
          label_am?: string | null
        }
        Update: {
          building_id?: string
          created_at?: string
          depth?: number | null
          floor_id?: string
          id?: string
          kind?: string
          label?: string | null
          rotation_deg?: number
          source?: string
          updated_at?: string
          width?: number | null
          x?: number
          y?: number
          wall_id?: string | null
          offset_m?: number | null
          height_m?: number | null
          sill_m?: number | null
          from_floor_id?: string | null
          to_floor_id?: string | null
          step_count?: number | null
          landing?: string | null
          accessible?: boolean | null
          label_am?: string | null
        }
        Relationships: []
      }
      venue_content: {
        Row: {
          stops: string[]
          body: string | null
          building_id: string
          created_at: string
          ends_at: string | null
          id: string
          image_url: string | null
          is_published: boolean
          kind: string
          poi_id: string | null
          sort_order: number
          starts_at: string | null
          summary: string | null
          title: string
          updated_at: string
        }
        Insert: {
          stops?: string[]
          body?: string | null
          building_id: string
          created_at?: string
          ends_at?: string | null
          id?: string
          image_url?: string | null
          is_published?: boolean
          kind: string
          poi_id?: string | null
          sort_order?: number
          starts_at?: string | null
          summary?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          stops?: string[]
          body?: string | null
          building_id?: string
          created_at?: string
          ends_at?: string | null
          id?: string
          image_url?: string | null
          is_published?: boolean
          kind?: string
          poi_id?: string | null
          sort_order?: number
          starts_at?: string | null
          summary?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      platform_admins: {
        Row: {
          user_id: string
          created_at: string
        }
        Insert: {
          user_id: string
          created_at?: string
        }
        Update: {
          user_id?: string
          created_at?: string
        }
        Relationships: []
      }
      layer_labels: {
        Row: {
          id: string
          building_id: string
          import_id: string
          file_name: string
          source_path: string | null
          layer_name: string
          layer_summary: Json
          summarizer_version: number
          prompt_version: number | null
          ai_model: string | null
          ai_label: string
          ai_confidence: number | null
          final_label: string | null
          was_corrected: boolean
          human_verified: boolean
          confirmed_via: string | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          building_id: string
          import_id: string
          file_name: string
          source_path?: string | null
          layer_name: string
          layer_summary: Json
          summarizer_version: number
          prompt_version?: number | null
          ai_model?: string | null
          ai_label: string
          ai_confidence?: number | null
          final_label?: string | null
          was_corrected?: boolean
          human_verified?: boolean
          confirmed_via?: string | null
          created_by?: string | null
          created_at?: string
        }
        Update: {
          final_label?: string | null
          human_verified?: boolean
          confirmed_via?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "layer_labels_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          }
        ]
      }
      layer_training_consents: {
        Row: {
          id: string
          seq: number
          building_id: string
          decided_by: string | null
          notice_version: number
          accepted: boolean
          created_at: string
        }
        Insert: {
          id?: string
          building_id: string
          decided_by?: string | null
          notice_version: number
          accepted: boolean
          created_at?: string
        }
        Update: {
          [_ in never]: never
        }
        Relationships: [
          {
            foreignKeyName: "layer_training_consents_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          }
        ]
      }
      user_accounts: {
        Row: {
          user_id: string
          username: string
          display_name: string
          created_at: string
        }
        Insert: {
          user_id: string
          username: string
          display_name?: string
          created_at?: string
        }
        Update: {
          user_id?: string
          username?: string
          display_name?: string
          created_at?: string
        }
        Relationships: []
      }
      venue_snapshots: {
        Row: {
          building_id: string
          data: Json
          published_at: string
          published_by: string | null
        }
        Insert: {
          building_id: string
          data: Json
          published_at?: string
          published_by?: string | null
        }
        Update: {
          building_id?: string
          data?: Json
          published_at?: string
          published_by?: string | null
        }
        Relationships: []
      }
      venue_activity: {
        Row: {
          id: number
          building_id: string
          actor_id: string | null
          actor_name: string | null
          action: string
          object_type: string
          object_name: string | null
          count: number
          created_at: string
        }
        Insert: {
          id?: number
          building_id: string
          actor_id?: string | null
          actor_name?: string | null
          action: string
          object_type: string
          object_name?: string | null
          count?: number
          created_at?: string
        }
        Update: {
          id?: number
          building_id?: string
          actor_id?: string | null
          actor_name?: string | null
          action?: string
          object_type?: string
          object_name?: string | null
          count?: number
          created_at?: string
        }
        Relationships: []
      }
      partner_keys: {
        Row: {
          allowed_building_ids: string[] | null
          api_key: string
          created_at: string
          id: string
          is_active: boolean
          partner_name: string
          updated_at: string
        }
        Insert: {
          allowed_building_ids?: string[] | null
          api_key: string
          created_at?: string
          id?: string
          is_active?: boolean
          partner_name: string
          updated_at?: string
        }
        Update: {
          allowed_building_ids?: string[] | null
          api_key?: string
          created_at?: string
          id?: string
          is_active?: boolean
          partner_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      rooms: {
        Row: {
          building_id: string
          created_at: string
          floor_id: string
          height: number
          id: string
          name: string
          node_id: string | null
          polygon: Json | null
          source: string
          type: string
          updated_at: string
          width: number
          x: number
          y: number
          name_am: string | null
          floor_material: string
          has_ceiling: boolean
        }
        Insert: {
          building_id: string
          created_at?: string
          floor_id: string
          height?: number
          id?: string
          name?: string
          node_id?: string | null
          polygon?: Json | null
          source?: string
          type?: string
          updated_at?: string
          width?: number
          x?: number
          y?: number
          name_am?: string | null
          floor_material?: string
          has_ceiling?: boolean
        }
        Update: {
          building_id?: string
          created_at?: string
          floor_id?: string
          height?: number
          id?: string
          name?: string
          node_id?: string | null
          polygon?: Json | null
          source?: string
          type?: string
          updated_at?: string
          width?: number
          x?: number
          y?: number
          name_am?: string | null
          floor_material?: string
          has_ceiling?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "rooms_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rooms_floor_id_fkey"
            columns: ["floor_id"]
            isOneToOne: false
            referencedRelation: "floors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rooms_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      walls: {
        Row: {
          building_id: string
          created_at: string
          floor_id: string
          id: string
          source: string
          x1: number
          x2: number
          y1: number
          y2: number
          thickness_m: number | null
          height_m: number | null
          material: string
        }
        Insert: {
          building_id: string
          created_at?: string
          floor_id: string
          id?: string
          source?: string
          x1: number
          x2: number
          y1: number
          y2: number
          thickness_m?: number | null
          height_m?: number | null
          material?: string
        }
        Update: {
          building_id?: string
          created_at?: string
          floor_id?: string
          id?: string
          source?: string
          x1?: number
          x2?: number
          y1?: number
          y2?: number
          thickness_m?: number | null
          height_m?: number | null
          material?: string
        }
        Relationships: [
          {
            foreignKeyName: "walls_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "walls_floor_id_fkey"
            columns: ["floor_id"]
            isOneToOne: false
            referencedRelation: "floors"
            referencedColumns: ["id"]
          },
        ]
      }
      buildings: {
        Row: {
          tagline: string | null
          cover_url: string | null
          hero_view: string
          home_rank: number
          map_settings: Json
          layout: string
          published_at: string | null
          published_by: string | null
          theme: string
          institution_id: string | null
          created_at: string
          description: string | null
          id: string
          is_published: boolean
          is_search_popular: boolean
          meters_per_pixel: number
          name: string
          origin_lat: number | null
          origin_lng: number | null
          rotation_deg: number
          updated_at: string
          version: number
        }
        Insert: {
          tagline?: string | null
          cover_url?: string | null
          hero_view?: string
          home_rank?: number
          map_settings?: Json
          layout?: string
          published_at?: string | null
          published_by?: string | null
          theme?: string
          institution_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_published?: boolean
          is_search_popular?: boolean
          meters_per_pixel?: number
          name: string
          origin_lat?: number | null
          origin_lng?: number | null
          rotation_deg?: number
          updated_at?: string
          version?: number
        }
        Update: {
          tagline?: string | null
          cover_url?: string | null
          hero_view?: string
          home_rank?: number
          map_settings?: Json
          layout?: string
          published_at?: string | null
          published_by?: string | null
          theme?: string
          institution_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_published?: boolean
          is_search_popular?: boolean
          meters_per_pixel?: number
          name?: string
          origin_lat?: number | null
          origin_lng?: number | null
          rotation_deg?: number
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      edges: {
        Row: {
          source: string
          accessible: boolean
          building_id: string
          connection: string | null
          created_at: string
          from_node: string
          id: string
          to_node: string
          updated_at: string
          weight: number
        }
        Insert: {
          source?: string
          accessible?: boolean
          building_id: string
          connection?: string | null
          created_at?: string
          from_node: string
          id?: string
          to_node: string
          updated_at?: string
          weight?: number
        }
        Update: {
          source?: string
          accessible?: boolean
          building_id?: string
          connection?: string | null
          created_at?: string
          from_node?: string
          id?: string
          to_node?: string
          updated_at?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "edges_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "edges_from_node_fkey"
            columns: ["from_node"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "edges_to_node_fkey"
            columns: ["to_node"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      floor_drawings: {
        Row: {
          floor_id: string
          building_id: string
          drawing: Json
          published: Json | null
          updated_at: string
        }
        Insert: {
          floor_id: string
          building_id: string
          drawing: Json
          published?: Json | null
          updated_at?: string
        }
        Update: {
          floor_id?: string
          building_id?: string
          drawing?: Json
          published?: Json | null
          updated_at?: string
        }
        Relationships: []
      }
      floors: {
        Row: {
          building_id: string
          created_at: string
          id: string
          level: number
          name: string
          svg_url: string | null
          updated_at: string
          elevation_m: number | null
          ceiling_height_m: number | null
          sort_order: number | null
          name_am: string | null
          plan_underlay: Json | null
        }
        Insert: {
          building_id: string
          created_at?: string
          id?: string
          level?: number
          name: string
          svg_url?: string | null
          updated_at?: string
          elevation_m?: number | null
          ceiling_height_m?: number | null
          sort_order?: number | null
          name_am?: string | null
          plan_underlay?: Json | null
        }
        Update: {
          building_id?: string
          created_at?: string
          id?: string
          level?: number
          name?: string
          svg_url?: string | null
          updated_at?: string
          elevation_m?: number | null
          ceiling_height_m?: number | null
          sort_order?: number | null
          name_am?: string | null
          plan_underlay?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "floors_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
        ]
      }
      nodes: {
        Row: {
          source: string
          building_id: string
          created_at: string
          floor_id: string
          id: string
          is_hallway: boolean
          name: string
          type: string
          updated_at: string
          x: number
          y: number
        }
        Insert: {
          source?: string
          building_id: string
          created_at?: string
          floor_id: string
          id?: string
          is_hallway?: boolean
          name?: string
          type?: string
          updated_at?: string
          x?: number
          y?: number
        }
        Update: {
          source?: string
          building_id?: string
          created_at?: string
          floor_id?: string
          id?: string
          is_hallway?: boolean
          name?: string
          type?: string
          updated_at?: string
          x?: number
          y?: number
        }
        Relationships: [
          {
            foreignKeyName: "nodes_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nodes_floor_id_fkey"
            columns: ["floor_id"]
            isOneToOne: false
            referencedRelation: "floors"
            referencedColumns: ["id"]
          },
        ]
      }
      pois: {
        Row: {
          accessibility: Json
          custom_type: string | null
          floor_id: string | null
          images: string[]
          navigable: boolean
          opening_hours: Json | null
          place_type: string | null
          is_visible: boolean
          audio_url: string | null
          building_id: string
          category: string
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          is_featured: boolean
          is_outdoor: boolean
          is_search_popular: boolean
          lat: number | null
          lng: number | null
          name: string
          node_id: string | null
          subcategory: string | null
          trigger_radius: number
          updated_at: string
          room_id: string | null
          name_am: string | null
          description_am: string | null
        }
        Insert: {
          accessibility?: Json
          custom_type?: string | null
          floor_id?: string | null
          images?: string[]
          navigable?: boolean
          opening_hours?: Json | null
          place_type?: string | null
          is_visible?: boolean
          audio_url?: string | null
          building_id: string
          category?: string
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_featured?: boolean
          is_outdoor?: boolean
          is_search_popular?: boolean
          lat?: number | null
          lng?: number | null
          name: string
          node_id?: string | null
          subcategory?: string | null
          trigger_radius?: number
          updated_at?: string
          room_id?: string | null
          name_am?: string | null
          description_am?: string | null
        }
        Update: {
          accessibility?: Json
          custom_type?: string | null
          floor_id?: string | null
          images?: string[]
          navigable?: boolean
          opening_hours?: Json | null
          place_type?: string | null
          is_visible?: boolean
          audio_url?: string | null
          building_id?: string
          category?: string
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_featured?: boolean
          is_outdoor?: boolean
          is_search_popular?: boolean
          lat?: number | null
          lng?: number | null
          name?: string
          node_id?: string | null
          subcategory?: string | null
          trigger_radius?: number
          updated_at?: string
          room_id?: string | null
          name_am?: string | null
          description_am?: string | null
        }
        Relationships: []
      }
      venue_nodes: {
        Row: {
          id: string
          building_id: string
          name: string
          lat: number
          lng: number
          kind: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          building_id: string
          name?: string
          lat: number
          lng: number
          kind?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          building_id?: string
          name?: string
          lat?: number
          lng?: number
          kind?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_nodes_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          }
        ]
      }
      venue_paths: {
        Row: {
          id: string
          building_id: string
          from_node: string | null
          from_poi: string | null
          to_node: string | null
          to_poi: string | null
          path_type: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          building_id: string
          from_node?: string | null
          from_poi?: string | null
          to_node?: string | null
          to_poi?: string | null
          path_type?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          building_id?: string
          from_node?: string | null
          from_poi?: string | null
          to_node?: string | null
          to_poi?: string | null
          path_type?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_paths_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_paths_from_node_fkey"
            columns: ["from_node"]
            isOneToOne: false
            referencedRelation: "venue_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_paths_to_node_fkey"
            columns: ["to_node"]
            isOneToOne: false
            referencedRelation: "venue_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_paths_from_poi_fkey"
            columns: ["from_poi"]
            isOneToOne: false
            referencedRelation: "pois"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_paths_to_poi_fkey"
            columns: ["to_poi"]
            isOneToOne: false
            referencedRelation: "pois"
            referencedColumns: ["id"]
          }
        ]
      }
      promotions: {
        Row: {
          badge_color: string | null
          created_at: string
          description: string | null
          discount_text: string | null
          ends_at: string | null
          id: string
          is_active: boolean
          poi_id: string
          starts_at: string | null
          title: string
          updated_at: string
        }
        Insert: {
          badge_color?: string | null
          created_at?: string
          description?: string | null
          discount_text?: string | null
          ends_at?: string | null
          id?: string
          is_active?: boolean
          poi_id: string
          starts_at?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          badge_color?: string | null
          created_at?: string
          description?: string | null
          discount_text?: string | null
          ends_at?: string | null
          id?: string
          is_active?: boolean
          poi_id?: string
          starts_at?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          id: string
          user_id: string
          full_name: string | null
          email: string | null
          language: string
          location: string | null
          preferred_park: string | null
          places_visited: number
          steps_walked: number
          badges_earned: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          full_name?: string | null
          email?: string | null
          language?: string
          location?: string | null
          preferred_park?: string | null
          places_visited?: number
          steps_walked?: number
          badges_earned?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          full_name?: string | null
          email?: string | null
          language?: string
          location?: string | null
          preferred_park?: string | null
          places_visited?: number
          steps_walked?: number
          badges_earned?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      saved_places: {
        Row: {
          id: string
          profile_id: string
          poi_id: string
          created_at: string
        }
        Insert: {
          id?: string
          profile_id: string
          poi_id: string
          created_at?: string
        }
        Update: {
          id?: string
          profile_id?: string
          poi_id?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_places_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_places_poi_id_fkey"
            columns: ["poi_id"]
            isOneToOne: false
            referencedRelation: "pois"
            referencedColumns: ["id"]
          }
        ]
      }
      daily_steps: {
        Row: {
          id: string
          profile_id: string
          log_date: string
          steps: number
          updated_at: string
        }
        Insert: {
          id?: string
          profile_id: string
          log_date?: string
          steps?: number
          updated_at?: string
        }
        Update: {
          id?: string
          profile_id?: string
          log_date?: string
          steps?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_steps_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      visited_places: {
        Row: {
          id: string
          profile_id: string
          poi_id: string
          visit_count: number
          source: string
          first_visited_at: string
          last_visited_at: string
        }
        Insert: {
          id?: string
          profile_id: string
          poi_id: string
          visit_count?: number
          source?: string
          first_visited_at?: string
          last_visited_at?: string
        }
        Update: {
          id?: string
          profile_id?: string
          poi_id?: string
          visit_count?: number
          source?: string
          first_visited_at?: string
          last_visited_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "visited_places_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visited_places_poi_id_fkey"
            columns: ["poi_id"]
            isOneToOne: false
            referencedRelation: "pois"
            referencedColumns: ["id"]
          }
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      user_can_edit_building: { Args: { b: string }; Returns: boolean }
      user_can_edit_institution: { Args: { inst: string }; Returns: boolean }
      user_is_platform_admin: { Args: Record<PropertyKey, never>; Returns: boolean }
      user_can_consent_for_building: { Args: { b: string }; Returns: boolean }
      layer_training_consent_current: { Args: { b: string }; Returns: boolean }
      publish_venue: { Args: { b: string }; Returns: string }
      unpublish_venue: { Args: { b: string }; Returns: undefined }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const